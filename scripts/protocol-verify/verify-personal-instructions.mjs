// Real isolated global AGENTS.md consumption; never authenticates or starts a model turn.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-personal-instructions-"));
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
    clientInfo: { name: "codex-native-personal-instructions-probe", version: "0.1.0" },
    capabilities: { experimentalApi: true },
  });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} }) + "\n");
  const global = "PI_NATIVE_GLOBAL_SENTINEL_20261101";
  const override = "PI_NATIVE_OVERRIDE_SENTINEL_20261101";
  const project = "PI_NATIVE_PROJECT_SENTINEL_20261101";
  const observations = [];
  async function put(fileName, text) {
    await request("fs/writeFile", { path: path.join(home, fileName), dataBase64: Buffer.from(text).toString("base64") });
  }
  fs.writeFileSync(path.join(workspace, "AGENTS.md"), project, "utf8");
  await put("AGENTS.md", global + "\n");
  for (const scenario of ["global", "override", "blank-override", "cleared"]) {
    if (scenario === "override") await put("AGENTS.override.md", override);
    if (scenario === "blank-override") await put("AGENTS.override.md", "  \r\n\t");
    if (scenario === "cleared") await put("AGENTS.md", "");
    const { thread } = await request("thread/start", { cwd: workspace, approvalPolicy: "on-request", sandbox: "read-only" });
    await request("thread/inject_items", { threadId: thread.id, items: [{ type: "message", role: "user", content: [{ type: "input_text", text: "offline personalization fixture" }] }] });
    const loaded = await request("thread/read", { threadId: thread.id, includeTurns: true });
    const rows = fs.readFileSync(loaded.thread.path, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line));
    const instructions = rows.filter(row => row.type === "response_item" && row.payload.role === "user")
      .flatMap(row => row.payload.content || []).filter(item => typeof item.text === "string" && item.text.includes("# AGENTS.md instructions"))
      .map(item => item.text).join("\n");
    assert.ok(instructions.includes(project), "project instructions remain applied");
    assert.equal(instructions.includes(global), scenario === "global" || scenario === "blank-override");
    assert.equal(instructions.includes(override), scenario === "override");
    observations.push({ scenario, threadId: thread.id, rolloutPath: loaded.thread.path, instructions });
    check(`${scenario}: actual persisted instructions match global/override/project precedence`);
  }
  fs.mkdirSync(".ref/parity/16.07/runs/20261101-codex-personalization/actual", { recursive: true });
  fs.writeFileSync(".ref/parity/16.07/runs/20261101-codex-personalization/actual/instruction-consumers.json", JSON.stringify(observations, null, 2));
  assert.ok(!notifications.some(event => event.method === "turn/started"));
  check("zero model turns; new threads pick up saved instructions without app-server restart");
  passed = true;
} catch (error) {
  failure = String(error?.stack || error);
  throw error;
} finally {
  await stop();
  const output = process.env.PERSONAL_INSTRUCTIONS_PROBE_OUTPUT || ".ref/parity/16.07/runs/20261101-codex-personalization/actual/protocol-personal-instructions.json";
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({
    capturedAt: new Date().toISOString(), binary, version: version.stdout.trim(), isolatedHome: home,
    passed, failure, checks, transcript, notifications, stderr,
    scope: "real isolated CLI personalization observation; not Tauri record persistence, official UI, or pixel parity",
  }, null, 2));
  console.log(`Evidence: ${output}`);
}
