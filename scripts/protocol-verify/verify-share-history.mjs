// Real empty/context-only history boundary; multipage histories use deterministic fixtures.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-share-history-"));
const home = path.join(root, "home"), workspace = path.join(root, "workspace");
fs.mkdirSync(home); fs.mkdirSync(workspace);
const binary = process.env.CODEX_CLI_PATH || (process.platform === "win32" ? "codex.cmd" : "codex");
const processOptions = {
  shell: binary.endsWith(".cmd"), windowsHide: true,
  env: { ...process.env, CODEX_HOME: home, OPENAI_API_KEY: "", CODEX_API_KEY: "" },
};
const version = spawnSync(binary, ["--version"], { ...processOptions, encoding: "utf8" });
assert.equal(version.status, 0, version.stderr);
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/shareThreadHistory.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: module.exports, Error, Set });
const transcript = [], notifications = [], checks = [], pending = new Map();
let buffer = "", stderr = "", nextId = 1, passed = false;
let child;
async function start() {
  buffer = "";
  child = spawn(binary, ["app-server", "--listen", "stdio://"], {
    ...processOptions, stdio: ["pipe", "pipe", "pipe"],
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
      else notifications.push(message);
    }
  });
  await rpc("initialize", {
    clientInfo: { name: "codex-native-share-history-probe", version: "0.1.0" },
    capabilities: { experimentalApi: true },
  });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} }) + "\n");
}
async function stop() {
  if (child && child.exitCode == null) await new Promise(resolve => { child.once("exit", resolve); child.stdin.end(); });
}
function rpc(method, params) {
  assert.ok(["initialize", "thread/start", "thread/inject_items", "thread/read", "thread/turns/list"].includes(method));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} timed out`)); }, 20000);
    pending.set(id, message => {
      clearTimeout(timer); pending.delete(id);
      transcript.push({ method, params, response: message });
      if (message.error) reject(Error(`${method}: ${JSON.stringify(message.error)}`));
      else resolve(message.result);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
try {
  await start();
  const { thread } = await rpc("thread/start", { cwd: workspace, approvalPolicy: "on-request", sandbox: "read-only" });
  await rpc("thread/inject_items", {
    threadId: thread.id,
    items: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Offline context seed; no generation." }] }],
  });
  // inject_items supplies model context, not visible user-message history. A share
  // must not fabricate a visible turn from that context or resume execution.
  await stop();
  await start();
  const readStart = transcript.length;
  const history = await module.exports.readShareThreadHistory({
    threadId: thread.id, signal: new AbortController().signal,
  }, rpc);
  assert.equal(history.id, thread.id);
  assert.equal(path.resolve(history.cwd).toLowerCase(), path.resolve(workspace).toLowerCase());
  assert.equal(history.turns.length, 0, "context-only injection is not visible history");
  const reads = transcript.slice(readStart).filter(entry => entry.method === "thread/turns/list");
  assert.equal(reads.length, 1);
  assert.ok(reads.every(entry => entry.params.limit === 5 && entry.params.itemsView === "full" && entry.params.sortDirection === "asc"));
  assert.equal(reads.at(-1).response.result.nextCursor, null);
  assert.equal(notifications.filter(event => event.method === "turn/started").length, 0);
  const after = await rpc("thread/read", { threadId: thread.id, includeTurns: false });
  assert.equal(after.thread.status.type, "notLoaded", "share read cannot resume execution");
  checks.push("context-only history remains empty; invisible model context is not manufactured into a share");
  checks.push("production loader sends full asc limit-5 request and terminates at null cursor");
  checks.push("reading history leaves the execution thread unloaded");
  checks.push("zero model turns; isolated CODEX_HOME; no credentials");
  passed = true;
  checks.forEach(check => console.log(`PASS ${check}`));
} finally {
  await stop();
  const output = process.env.SHARE_HISTORY_PROBE_OUTPUT || ".ref/protocol-probe/share-history-empty.json";
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({
    capturedAt: new Date().toISOString(), passed, binary, version: version.stdout.trim(),
    binarySha256: fs.existsSync(binary) ? createHash("sha256").update(fs.readFileSync(binary)).digest("hex") : null,
    isolatedHome: home, workspace, fixtureKind: "context-only-empty-history-no-model-turn",
    unverified: ["nonempty real history", "multipage real history", "concurrent real turns"],
    checks, transcript, notifications, ...(passed ? {} : { stderr }),
  }, null, 2));
  console.log(`Evidence: ${output}`);
}
