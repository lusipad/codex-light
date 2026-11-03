// Persistent beta feature verification in an isolated CODEX_HOME; zero model turns.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-experimental-features-"));
const binary = process.env.CODEX_CLI_PATH || (process.platform === "win32" ? "codex.cmd" : "codex");
const options = {
  shell: binary.endsWith(".cmd"), windowsHide: true,
  env: { ...process.env, CODEX_HOME: home, OPENAI_API_KEY: "", CODEX_API_KEY: "" },
};
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
    const message = JSON.parse(line);
    if (message.id != null) pending.get(message.id)?.resolve(message);
  }
});
child.on("error", error => { for (const item of pending.values()) item.reject(error); });
child.on("exit", () => { for (const item of pending.values()) item.reject(Error("app-server exited before response")); });
async function rpc(method, params) {
  assert.ok(["initialize", "config/read", "experimentalFeature/list", "config/batchWrite"].includes(method), "probe is restricted to isolated config verification");
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
let passed = false;
try {
  await rpc("initialize", { clientInfo: { name: "codex-native-beta-probe", version: "0.1.0" }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
  const all = []; let cursor = null; const cursors = new Set();
  do {
    const page = await rpc("experimentalFeature/list", { cursor, limit: 7 });
    all.push(...page.data); cursor = page.nextCursor ?? null;
    assert.ok(!cursor || !cursors.has(cursor)); if (cursor) cursors.add(cursor);
  } while (cursor);
  const excluded = new Set(["memories", "multi_agent", "plugins", "plugin", "remote_control", "chronicle", "workspace_dependencies", "default_mode_request_user_input"]);
  const feature = all.find(f => f.stage === "beta" && !excluded.has(f.name) && !f.name.startsWith("realtime_"));
  assert.ok(feature, "CLI fixture needs a beta feature for persistent readback");
  const value = !feature.enabled, keyPath = `features.${feature.name}`;
  const before = await rpc("config/read", { includeLayers: true });
  await rpc("config/batchWrite", { edits: [{ keyPath, value, mergeStrategy: "upsert" }], filePath: null, expectedVersion: null, reloadUserConfig: false });
  const after = await rpc("config/read", { includeLayers: true });
  const layer = after.layers.find(x => x.name?.type === "user" && !x.name.profile && !x.disabledReason);
  assert.equal(layer.config.features[feature.name], value);
  assert.ok(layer.name.file.startsWith(home));
  assert.match(fs.readFileSync(layer.name.file, "utf8"), new RegExp(`${feature.name}\\s*=\\s*${value}`));
  // A new process consumes the saved file, unlike enablement/set-only runtime state.
  const check = spawnSync(binary, ["features", "list"], { ...options, encoding: "utf8" });
  assert.equal(check.status, 0, check.stderr);
  assert.ok(check.stdout.split(/\r?\n/).some(line => line.trim().split(/\s{2,}/)[0] === feature.name && line.trim().split(/\s{2,}/).at(-1) === String(value)), check.stdout);
  passed = true;
  console.log("PASS persistent beta: small-page discovery, config/batchWrite, user-layer and disk readback, fresh CLI process consumes saved flag; zero model turns");
} catch (error) { failure = String(error?.stack || error); throw error; }
finally {
  const stopped = new Promise(resolve => child.once("exit", resolve));
  child.stdin.end(); const kill = setTimeout(() => child.kill(), 2000);
  await stopped; clearTimeout(kill);
  const output = process.env.EXPERIMENTAL_FEATURES_PROBE_OUTPUT || ".ref/parity/16.20/actual/protocol-experimental-features.json";
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ capturedAt: new Date().toISOString(), binary, version: version.stdout.trim(), isolatedHome: home, passed, failure, calls, stderr: errorOutput, scope: "isolated config persistence, not official runtime gate, Tauri UI or pixel parity" }, null, 2));
}
