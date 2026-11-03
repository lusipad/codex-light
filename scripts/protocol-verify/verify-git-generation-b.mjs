// Only creates read-only ephemeral threads in a private home; never starts a model turn.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-git-generation-"));
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "codex-git-generation-work-"));
const binary = process.env.CODEX_CLI_PATH || (process.platform === "win32" ? "codex.cmd" : "codex");
const options = { shell: binary.endsWith(".cmd"), windowsHide: true,
  env: { ...process.env, CODEX_HOME: home, OPENAI_API_KEY: "", CODEX_API_KEY: "" } };
const version = spawnSync(binary, ["--version"], { ...options, encoding: "utf8" });
assert.equal(version.status, 0, version.stderr);
const child = spawn(binary, ["app-server", "--listen", "stdio://"], { ...options, stdio: ["pipe", "pipe", "pipe"] });
const pending = new Map(), calls = [];
let nextId = 0, buffer = "", errorOutput = "", failure = null;
child.stderr.on("data", data => { errorOutput = (errorOutput + data).slice(-4000); });
child.stdout.setEncoding("utf8");
child.stdout.on("data", data => {
  buffer += data;
  let end;
  while ((end = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
    if (!line) continue;
    try {
      const message = JSON.parse(line);
      if (message.id != null && !message.method) pending.get(message.id)?.resolve(message);
    } catch (error) { for (const item of pending.values()) item.reject(error); }
  }
});
child.on("error", error => { for (const item of pending.values()) item.reject(error); });
child.on("exit", () => { for (const item of pending.values()) item.reject(Error("app-server exited before response")); });
async function rpc(method, params) {
  assert.ok(["initialize", "config/read", "model/list", "thread/start", "thread/unsubscribe"].includes(method), "no model turns or Git writes allowed");
  const id = ++nextId;
  let timer;
  try {
    const response = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(Error(`${method} timeout`)), 20000);
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
    calls.push({ method, params, response });
    assert.equal(response.error, undefined, `${method}: ${JSON.stringify(response.error)}`);
    return response.result;
  } finally { clearTimeout(timer); pending.delete(id); }
}
try {
  await rpc("initialize", { clientInfo: { name: "codex-native-git-generation-probe", version: "0.1.0" }, capabilities: { experimentalApi: true } });
  const configured = await rpc("config/read", { includeLayers: false });
  const catalog = [];
  let cursor = null;
  do {
    const page = await rpc("model/list", { cursor, limit: 100, includeHidden: false });
    catalog.push(...page.data); cursor = page.nextCursor ?? null;
  } while (cursor);
  const model = catalog.find(item => item.isDefault) ?? catalog[0];
  assert.ok(model?.model, "actual catalog must advertise a model");
  for (const threadSource of ["commit_message", "pull_request_message", "commit_pull_request_message"]) {
    const response = await rpc("thread/start", {
      model: model.model, modelProvider: configured.config.model_provider ?? null, cwd,
      ephemeral: true, approvalPolicy: "never", sandbox: "read-only", serviceTier: null, personality: null,
      threadSource, experimentalRawEvents: false, dynamicTools: null,
      config: { "mcp_servers.codex_app": { enabled: false, command: "" }, model_reasoning_effort: "low",
        "features.enable_fanout": false, "features.multi_agent": false, "features.multi_agent_v2": false, web_search: "disabled" },
    });
    assert.equal(response.thread.ephemeral, true);
    assert.equal(response.approvalPolicy, "never");
    assert.equal(response.sandbox.type, "readOnly");
    assert.equal(path.resolve(response.cwd), path.resolve(cwd));
    assert.equal(response.reasoningEffort, "low");
    assert.ok(response.thread.id);
    await rpc("thread/unsubscribe", { threadId: response.thread.id });
  }
  console.log(`PASS ${version.stdout.trim()}: three private ephemeral/readOnly/never/low thread modes; zero model turns`);
} catch (error) { failure = String(error); process.exitCode = 1; console.error(error); }
finally {
  if (child.exitCode == null) await new Promise(resolve => {
    const timer = setTimeout(() => { child.kill(); resolve(); }, 3000);
    child.once("exit", () => { clearTimeout(timer); resolve(); }); child.stdin.end();
  });
  const directory = ".ref/parity/16.13/actual/16-13B";
  fs.mkdirSync(directory, { recursive: true });
  const label = version.stdout.trim().replace(/[^a-zA-Z0-9.-]+/g, "-");
  fs.writeFileSync(path.join(directory, `protocol-git-generation-${label}.json`), JSON.stringify({ version: version.stdout.trim(), isolatedHome: home, cwd, calls, failure, errorOutput, modelTurns: 0, gitWrites: 0,
    limits: ["No turn/start or actual model execution", "No explicit runtimeWorkspaceRoots or named permissions: common-version adapter"] }, null, 2));
}
