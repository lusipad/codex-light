// Read-only discovery in an isolated CODEX_HOME; never authenticates or creates a turn.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-hook-state-"));
fs.writeFileSync(path.join(home, "config.toml"), "[features]\nhooks = true\n");
fs.writeFileSync(path.join(home, "hooks.json"), JSON.stringify({ hooks: {
  PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "echo parity-hook-no-execution" }] }],
} }, null, 2));
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
  assert.ok(["initialize", "config/read", "configRequirements/read", "config/batchWrite", "hooks/list"].includes(method), "probe is restricted to isolated config verification");
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
    clientInfo: { name: "codex-native-hook-state-probe", version: "0.1.0" },
    capabilities: { experimentalApi: true },
  });
  const read = () => rpc("config/read", { includeLayers: true });
  const before = await read();
  const user = before.layers.find(layer => layer.name.type === "user" && !layer.name.profile);
  assert.ok(user?.name.file && user.version);
  assert.ok(path.resolve(user.name.file).startsWith(path.resolve(home) + path.sep));
  const listed = await rpc("hooks/list", { cwds: [home] });
  const hook = listed.data.flatMap(entry => entry.hooks).find(hook => hook.source === "user");
  assert.ok(hook?.key && hook.currentHash, JSON.stringify(listed));
  const prefix = `hooks.state.${JSON.stringify(hook.key)}`;
  const write = async (edits, expectedVersion) => rpc("config/batchWrite", { edits, filePath: user.name.file, expectedVersion, reloadUserConfig: true });
  const edit = { keyPath: `${prefix}.enabled`, value: false, mergeStrategy: "upsert" };
  await write([edit], user.version);
  const disabled = await rpc("hooks/list", { cwds: [home] });
  assert.equal(disabled.data.flatMap(entry => entry.hooks).find(item => item.key === hook.key).enabled, false);
  const after = await read();
  const afterUser = after.layers.find(layer => layer.name.type === "user" && !layer.name.profile);
  assert.equal(afterUser.config.hooks.state[hook.key].enabled, false);
  await assert.rejects(() => write([{ ...edit, value: true }], user.version));
  await write([{ ...edit, value: true }, { keyPath: `${prefix}.trusted_hash`, value: hook.currentHash, mergeStrategy: "upsert" }], afterUser.version);
  const trusted = await rpc("hooks/list", { cwds: [home] });
  const current = trusted.data.flatMap(entry => entry.hooks).find(item => item.key === hook.key);
  assert.equal(current.enabled, true);
  assert.equal(current.currentHash, hook.currentHash);
  assert.equal(current.trustStatus, "trusted");
  assert.equal((await read()).layers.find(layer => layer.name.type === "user").config.hooks.state[hook.key].trusted_hash, hook.currentHash);
  console.log("PASS real hooks fixture: disable/enable/trust effective readback and stale config version rejection; no hook execution or model turns");

} catch (error) {
  failure = String(error); process.exitCode = 1; console.error(error);
} finally {
  if (child.exitCode == null) await new Promise(resolve => {
    const timer = setTimeout(() => { child.kill(); resolve(); }, 3000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    child.stdin.end();
  });
  const directory = ".ref/parity/16.12/actual";
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "protocol-hook-state.json"), JSON.stringify({
    version: version.stdout.trim(), isolatedHome: home, calls, failure, errorOutput, modelTurns: 0,
  }, null, 2));
}
