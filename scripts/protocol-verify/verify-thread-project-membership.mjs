// Real isolated app-server writes/readbacks; never authenticates or starts a model turn.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-project-membership-"));
const home = path.join(root, "home");
const source = path.join(root, "source");
const target = path.join(root, "target");
for (const directory of [home, source, target]) fs.mkdirSync(directory);
const binary = process.env.CODEX_CLI_PATH || (process.platform === "win32" ? "codex.cmd" : "codex");
const options = {
  shell: binary.endsWith(".cmd"), windowsHide: true,
  env: { ...process.env, CODEX_HOME: home, OPENAI_API_KEY: "", CODEX_API_KEY: "" },
};
const version = spawnSync(binary, ["--version"], { ...options, encoding: "utf8" });
assert.equal(version.status, 0, version.stderr);
const transcript = [], notifications = [], checks = [];
let child, buffer = "", nextId = 1, stderr = "", passed = false;
const pending = new Map();
function rpc(method, params) {
  assert.notEqual(method, "turn/start", "probe must never request model generation");
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} timed out`)); }, 15000);
    pending.set(id, response => {
      clearTimeout(timer); pending.delete(id);
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
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message.id != null) pending.get(message.id)?.(message);
      else if (message.method) notifications.push(message);
    }
  });
  await request("initialize", {
    clientInfo: { name: "codex-native-project-membership-probe", version: "0.1.0" },
    capabilities: { experimentalApi: true },
  });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} }) + "\n");
}
async function stop() {
  if (!child || child.exitCode != null) return;
  await new Promise(resolve => { child.once("exit", resolve); child.stdin.end(); });
}
function check(name) { checks.push(name); console.log(`PASS ${name}`); }
try {
  await start();
  const projects = [];
  for (const [name, cwd] of [["source", source], ["target", target]]) {
    const { project } = await request("project/create", { idempotencyKey: `probe-${name}`, name, roots: [{ path: cwd }] });
    assert.ok(project.id);
    projects.push(project);
  }
  const { thread } = await request("thread/start", {
    cwd: source, projectId: projects[0].id, approvalPolicy: "on-request", sandbox: "read-only",
  });
  assert.equal(thread.projectId, projects[0].id);
  // Persist a clearly identified replay item, without generating a model response.
  await request("thread/inject_items", {
    threadId: thread.id,
    items: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Offline project membership probe fixture." }] }],
  });
  // inject_items is model context only. Mark this isolated rollout as an explicit
  // replay fixture so thread/list's "has visible user message" filter includes it.
  assert.ok(path.resolve(thread.path).startsWith(path.resolve(home) + path.sep));
  fs.appendFileSync(thread.path, JSON.stringify({
    timestamp: new Date().toISOString(), type: "event_msg",
    payload: { type: "user_message", message: "Offline project membership replay fixture.", images: [], local_images: [], text_elements: [] },
  }) + "\n");
  async function read(expected, label) {
    const result = await request("thread/read", { threadId: thread.id, includeTurns: false });
    assert.equal(result.thread.projectId, expected, label);
    return result;
  }
  async function checkReadState(operation, expected, label) {
    const before = await read(projects[0].id, `${label}: current assignment`);
    const changed = await request("thread/readState/update", {
      threadId: thread.id, expectedRevision: before.readState.revision, operation: { type: operation },
    });
    assert.equal(changed.readState.firstUnread?.type ?? null, expected, `${label}: response`);
    const readback = await read(projects[0].id, `${label}: persistent readback`);
    assert.equal(readback.readState.firstUnread?.type ?? null, expected, `${label}: thread/read`);
    check(label);
    return readback.readState;
  }
  const initial = await read(projects[0].id, "initial project readback");
  const supportsReadState = typeof initial.readState?.revision === "string";
  let finalUnread = null;
  if (supportsReadState) {
    const unreadState = await checkReadState("unread", "threadStart", "durable mark unread");
    const readState = await checkReadState("read", null, "durable mark read");
    const stale = await rpc("thread/readState/update", {
      threadId: thread.id, expectedRevision: unreadState.revision, operation: { type: "unread" },
    });
    assert.ok(stale.error, "stale revision must conflict instead of overwriting read activity");
    const afterStale = await read(projects[0].id, "stale read-state revision preserves current receipt");
    assert.equal(afterStale.readState.firstUnread, null);
    assert.ok(readState.revision);
    finalUnread = await checkReadState("unread", "threadStart", "read-state can be marked unread again");
  } else {
    checks.push("durable read-state unavailable in this CLI version");
    console.log("UNSUPPORTED durable read-state unavailable in this CLI version");
  }
  const move = await request("thread/metadata/update", { threadId: thread.id, projectId: projects[1].id });
  assert.equal(move.thread.projectId, projects[1].id, "successful response must carry new membership");
  await read(projects[1].id, "move to target readback");
  const invalid = await rpc("thread/metadata/update", { threadId: thread.id, projectId: "missing-project-probe" });
  assert.ok(invalid.error, "invalid target must fail");
  await read(projects[1].id, "invalid target leaves membership unchanged");
  await stop(); await start();
  await read(projects[1].id, "membership survives app-server restart");
  if (supportsReadState) {
    const restartedRead = await read(projects[1].id, "read-state readback after restart");
    assert.equal(restartedRead.readState.firstUnread?.type, "threadStart");
    assert.equal(restartedRead.readState.revision, finalUnread.revision, "restart preserves the durable receipt revision");
    check("unread receipt survives app-server restart");
  }
  await request("thread/metadata/update", { threadId: thread.id, projectId: "" });
  await read(null, "empty string clears membership");
  await stop(); await start();
  await read(null, "cleared membership survives app-server restart");
  await request("thread/metadata/update", { threadId: thread.id, projectId: projects[0].id });
  await read(projects[0].id, "projectless thread can rejoin source project");
  const list = await request("thread/list", { limit: 100, useStateDbOnly: false });
  assert.equal(list.data.find(item => item.id === thread.id)?.projectId, projects[0].id);
  check("list projection matches persisted assignment");
  assert.ok(!notifications.some(item => item.method === "turn/started"));
  check("zero model turns");
  passed = true;
} finally {
  await stop();
  const output = process.env.PROJECT_MEMBERSHIP_PROBE_OUTPUT || ".ref/protocol-probe/thread-project-membership.json";
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({
    capturedAt: new Date().toISOString(), binary, version: version.stdout.trim(),
    binarySha256: fs.existsSync(binary) ? createHash("sha256").update(fs.readFileSync(binary)).digest("hex") : null,
    isolatedHome: home, fixtureKind: "offline-injected-context-not-generated-conversation",
    passed, supportsReadState: checks.includes("durable read-state unavailable in this CLI version") ? false : true,
    checks, transcript, notifications, stderr,
  }, null, 2));
  console.log(`Evidence: ${output}`);
}
