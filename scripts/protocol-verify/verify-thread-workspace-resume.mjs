// Real, credential-free resume/readback probe. No model execution methods allowed.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-workspace-resume-"));
const home = path.join(root, "home");
const source = path.join(root, "source"), second = path.join(root, "second"), target = path.join(root, "target");
for (const directory of [home, source, second, target]) fs.mkdirSync(directory);
const binary = process.env.CODEX_CLI_PATH || (process.platform === "win32" ? "codex.cmd" : "codex");
const options = {
  shell: binary.endsWith(".cmd"), windowsHide: true,
  env: { ...process.env, CODEX_HOME: home, OPENAI_API_KEY: "", CODEX_API_KEY: "" },
};
const version = spawnSync(binary, ["--version"], { ...options, encoding: "utf8" });
assert.equal(version.status, 0, version.stderr);
const transcript = [], notifications = [], checks = [];
const pending = new Map();
let child, buffer = "", nextId = 1, stderr = "", passed = false;
async function rpc(method, params) {
  assert.ok(["initialize", "thread/start", "thread/inject_items", "thread/read", "thread/turns/list", "thread/resume"].includes(method));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} timeout`)); }, 20000);
    pending.set(id, response => {
      clearTimeout(timer); pending.delete(id); transcript.push({ method, params, response });
      if (response.error) reject(Error(`${method}: ${JSON.stringify(response.error)}`));
      else resolve(response.result);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
async function start() {
  buffer = "";
  child = spawn(binary, ["app-server", "--listen", "stdio://"], { ...options, stdio: ["pipe", "pipe", "pipe"] });
  child.stderr.on("data", data => { stderr = (stderr + data).slice(-8000); });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", data => {
    buffer += data;
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message.id != null) pending.get(message.id)?.(message);
      else notifications.push(message);
    }
  });
  await rpc("initialize", {
    clientInfo: { name: "codex-native-workspace-resume-probe", version: "0.1.0" },
    capabilities: { experimentalApi: true },
  });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} }) + "\n");
}
async function stop() {
  if (!child || child.exitCode != null) return;
  await new Promise(resolve => { child.once("exit", resolve); child.stdin.end(); });
}
function check(name) { checks.push(name); console.log(`PASS ${name}`); }
const equalPaths = (actual, expected) => assert.deepEqual(
  actual.map(item => path.resolve(item).toLowerCase()),
  expected.map(item => path.resolve(item).toLowerCase()),
);
try {
  await start();
  const started = await rpc("thread/start", {
    cwd: source, runtimeWorkspaceRoots: [source, second], approvalPolicy: "on-request", sandbox: "workspace-write",
  });
  const threadId = started.thread.id;
  await rpc("thread/inject_items", {
    threadId, items: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Offline workspace resume probe fixture." }] }],
  });
  await stop(); await start();
  const unloaded = await rpc("thread/read", { threadId, includeTurns: false });
  assert.equal(unloaded.thread.status.type, "notLoaded");
  const page = await rpc("thread/turns/list", { threadId, limit: 20, sortDirection: "desc", itemsView: "full" });
  assert.ok(Array.isArray(page.data));
  const afterHistory = await rpc("thread/read", { threadId, includeTurns: false });
  assert.equal(afterHistory.thread.status.type, "notLoaded", "successful history pagination does not resume execution");
  check("history reads leave the execution thread unloaded");
  const resumed = await rpc("thread/resume", { threadId });
  assert.equal(resumed.cwd, source);
  equalPaths(resumed.runtimeWorkspaceRoots, [source, second]);
  assert.notEqual(resumed.thread.status.type, "notLoaded");
  const loaded = await rpc("thread/read", { threadId, includeTurns: false });
  assert.notEqual(loaded.thread.status.type, "notLoaded");
  assert.ok(Array.isArray(loaded.thread.environments));
  check("resume restores loaded state, cwd, roots and effective environments without a model turn");
  // Loaded resume is not a workspace migration operation.
  const overridden = await rpc("thread/resume", { threadId, cwd: target, runtimeWorkspaceRoots: [target, second] });
  assert.equal(overridden.cwd, source);
  equalPaths(overridden.runtimeWorkspaceRoots, [source, second]);
  check("resume of an already loaded thread preserves its current context");
  await stop(); await start();
  const coldOverride = await rpc("thread/resume", { threadId, cwd: target, runtimeWorkspaceRoots: [target, second] });
  assert.equal(coldOverride.cwd, target);
  equalPaths(coldOverride.runtimeWorkspaceRoots, [target, second]);
  checks.push(`cold override observation: ${JSON.stringify({ cwd: coldOverride.cwd, roots: coldOverride.runtimeWorkspaceRoots, environments: coldOverride.thread.environments })}`);
  await stop(); await start();
  const again = await rpc("thread/resume", { threadId });
  assert.equal(again.cwd, target);
  equalPaths(again.runtimeWorkspaceRoots, [target, second]);
  checks.push(`restart context: ${JSON.stringify({ cwd: again.cwd, roots: again.runtimeWorkspaceRoots, environments: again.thread.environments })}`);
  assert.ok(!notifications.some(event => event.method === "turn/started"));
  check("zero model turns");
  passed = true;
} finally {
  await stop();
  const output = process.env.WORKSPACE_RESUME_PROBE_OUTPUT || ".ref/protocol-probe/thread-workspace-resume.json";
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({
    capturedAt: new Date().toISOString(), passed, binary, version: version.stdout.trim(),
    binarySha256: fs.existsSync(binary) ? createHash("sha256").update(fs.readFileSync(binary)).digest("hex") : null,
    isolatedHome: home, source, second, target, fixtureKind: "offline-injected-context-no-model-turn",
    checks, transcript, notifications, stderr,
  }, null, 2));
  console.log(`Evidence: ${output}`);
}
