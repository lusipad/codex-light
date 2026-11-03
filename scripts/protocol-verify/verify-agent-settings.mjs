// Read-only discovery in an isolated CODEX_HOME; never authenticates or creates a turn.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-agent-settings-"));
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
  assert.ok(["initialize", "config/read", "configRequirements/read", "config/batchWrite"].includes(method), "probe is restricted to isolated config verification");
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
  await rpc("initialize", {
    clientInfo: { name: "codex-native-agent-settings-probe", version: "0.1.0" },
    capabilities: { experimentalApi: true },
  });
  const read = () => rpc("config/read", { includeLayers: true });
  const before = await read();
  const user = before.layers.find(layer => layer.name.type === "user" && !layer.name.profile);
  assert.ok(user?.name.file && user.version);
  assert.ok(path.resolve(user.name.file).startsWith(path.resolve(home) + path.sep));
  const requirements = await rpc("configRequirements/read", {});
  const edit = { keyPath: "model_verbosity", value: "low", mergeStrategy: "replace" };
  const written = await rpc("config/batchWrite", { edits: [edit], filePath: user.name.file, expectedVersion: user.version, reloadUserConfig: true });
  assert.equal(written.status, "ok");
  const after = await read();
  assert.equal(after.config.model_verbosity, "low");
  const afterUser = after.layers.find(layer => layer.name.type === "user" && !layer.name.profile);
  assert.equal(afterUser.config.model_verbosity, "low");
  assert.notEqual(afterUser.version, user.version);
  await assert.rejects(() => rpc("config/batchWrite", { edits: [{ ...edit, value: "high" }], filePath: user.name.file, expectedVersion: user.version, reloadUserConfig: true }));
  assert.equal((await read()).config.model_verbosity, "low");
  await rpc("config/batchWrite", { edits: [{ ...edit, value: null }], filePath: user.name.file, expectedVersion: afterUser.version, reloadUserConfig: true });
  const cleared = await read();
  assert.equal(cleared.layers.find(layer => layer.name.type === "user" && !layer.name.profile).config.model_verbosity, undefined);
  console.log("PASS real config: user layer/version, requirements, write/readback, stale version rejection and null removal; zero model turns");
} catch (error) {
  failure = String(error); process.exitCode = 1; console.error(error);
} finally {
  if (child.exitCode == null) await new Promise(resolve => {
    const timer = setTimeout(() => { child.kill(); resolve(); }, 3000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    child.stdin.end();
  });
  const directory = ".ref/parity/16.06/runs/20261101-codex-agent-settings/actual";
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "protocol-agent-settings.json"), JSON.stringify({
    version: version.stdout.trim(), isolatedHome: home, calls, failure, errorOutput, modelTurns: 0,
  }, null, 2));
}
