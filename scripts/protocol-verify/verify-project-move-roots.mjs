// Isolated real protocol boundary: no authentication and no model generation.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-project-move-roots-"));
const home = path.join(directory, "home");
const roots = ["source", "source-extra", "target"].map(name => path.join(directory, name));
for (const location of [home, ...roots]) fs.mkdirSync(location);
const binary = process.env.CODEX_CLI_PATH || (process.platform === "win32" ? "codex.cmd" : "codex");
const options = {
  shell: binary.endsWith(".cmd"), windowsHide: true,
  env: { ...process.env, CODEX_HOME: home, OPENAI_API_KEY: "", CODEX_API_KEY: "" },
};
const version = spawnSync(binary, ["--version"], { ...options, encoding: "utf8" });
assert.equal(version.status, 0, version.stderr);
let child, buffer = "", nextId = 0, stderr = "", passed = false;
const pending = new Map(), transcript = [], notifications = [], checks = [];
function rpc(method, params) {
  assert.notEqual(method, "turn/start", "this probe cannot generate model turns");
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Error(`${method} timed out`));
    }, 15000);
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
async function start() {
  buffer = "";
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
    clientInfo: { name: "codex-native-project-move-roots-probe", version: "0.1.0" },
    capabilities: { experimentalApi: true },
  });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} }) + "\n");
}
async function stop() {
  if (!child || child.exitCode != null) return;
  await new Promise(resolve => { child.once("exit", resolve); child.stdin.end(); });
}
function check(name) { checks.push(name); console.log(`PASS ${name}`); }
const projectRoots = project => project.roots.map(root => root.path);
try {
  await start();
  const { project: source } = await request("project/create", {
    idempotencyKey: "move-source", name: "Source", roots: roots.slice(0, 2).map(path => ({ path })),
  });
  const { project: target } = await request("project/create", {
    idempotencyKey: "move-target", name: "Target", roots: [{ path: roots[2] }],
  });
  const { thread } = await request("thread/start", {
    cwd: roots[0], projectId: source.id, runtimeWorkspaceRoots: roots.slice(0, 2),
    approvalPolicy: "on-request", sandbox: "read-only",
  });
  await request("thread/inject_items", {
    threadId: thread.id,
    items: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Offline roots probe fixture." }] }],
  });
  // Prepare/cancel is read-only: neither membership nor project roots may change.
  assert.deepEqual(projectRoots((await request("project/read", { projectId: target.id })).project), [roots[2]]);
  assert.equal((await request("thread/read", { threadId: thread.id, includeTurns: false })).thread.projectId, source.id);
  check("read-only preparation leaves roots and membership unchanged");
  const expanded = [roots[2], ...roots.slice(0, 2)];
  await request("project/update", { projectId: target.id, roots: expanded.map(path => ({ path })) });
  assert.deepEqual(projectRoots((await request("project/read", { projectId: target.id })).project), expanded);
  check("target roots expansion persists the complete source project");
  const invalid = await rpc("thread/metadata/update", { threadId: thread.id, projectId: "missing-project-probe" });
  assert.ok(invalid.error);
  assert.equal((await request("thread/read", { threadId: thread.id, includeTurns: false })).thread.projectId, source.id);
  assert.deepEqual(projectRoots((await request("project/read", { projectId: target.id })).project), expanded);
  check("membership rejection does not implicitly undo successful roots expansion");
  await request("thread/metadata/update", { threadId: thread.id, projectId: target.id });
  let readback = await request("thread/read", { threadId: thread.id, includeTurns: false });
  assert.equal(readback.thread.projectId, target.id);
  assert.equal(readback.thread.cwd, thread.cwd, "assignment alone must not claim runtime workspace migration");
  check("membership move leaves runtime cwd unchanged until a subsequent turn");
  await stop();
  await start();
  assert.deepEqual(projectRoots((await request("project/read", { projectId: target.id })).project), expanded);
  readback = await request("thread/read", { threadId: thread.id, includeTurns: false });
  assert.equal(readback.thread.projectId, target.id);
  assert.equal(readback.thread.cwd, thread.cwd);
  await request("thread/metadata/update", { threadId: thread.id, projectId: "" });
  readback = await request("thread/read", { threadId: thread.id, includeTurns: false });
  assert.equal(readback.thread.projectId, null);
  assert.equal(readback.thread.cwd, thread.cwd);
  check("restart preserves expanded roots and membership; clearing preserves cwd");
  assert.ok(!notifications.some(event => event.method === "turn/started"));
  check("zero model turns");
  passed = true;
} finally {
  await stop();
  const output = process.env.PROJECT_MOVE_ROOTS_PROBE_OUTPUT || ".ref/protocol-probe/project-move-roots.json";
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({
    capturedAt: new Date().toISOString(), binary, version: version.stdout.trim(),
    isolatedHome: home, passed, checks, transcript, notifications, stderr,
    scope: "real RPC boundaries only; not the Tauri move transaction or an accepted model turn",
  }, null, 2));
  console.log(`Evidence: ${output}`);
}
