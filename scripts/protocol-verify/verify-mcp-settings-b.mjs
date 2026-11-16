// Zero-turn configuration probe in a fresh private CODEX_HOME; every MCP server stays disabled.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-mcp-settings-b-"));
const configFile = path.join(home, "config.toml");
const binary = process.env.CODEX_CLI_PATH || (process.platform === "win32" ? "codex.cmd" : "codex");
const options = { cwd: home, shell: binary.endsWith(".cmd"), windowsHide: true,
  env: { ...process.env, CODEX_HOME: home, OPENAI_API_KEY: "", CODEX_API_KEY: "" } };
fs.writeFileSync(configFile, `# MCP fixture heading
[mcp_servers.codex_app]
command = "fixture-never-launch"
enabled = false

[mcp_servers.sibling]
command = "fixture-never-launch"
enabled = false
fixture_unknown = "preserve me"

[mcp_servers.http_fixture]
url = "https://example.invalid/mcp"
enabled = false
bearer_token_env_var = "FIXTURE_TOKEN_NOT_SET"
startup_timeout_sec = 12
tool_timeout_sec = 20
enabled_tools = ["fixture_tool"]
[mcp_servers.http_fixture.http_headers]
"X-Fixture" = "not a secret"
[mcp_servers.http_fixture.env_http_headers]
"X-Env" = "FIXTURE_HEADER_NOT_SET"
`);
const version = spawnSync(binary, ["--version"], { ...options, encoding: "utf8" });
assert.equal(version.status, 0, version.stderr);
const child = spawn(binary, ["app-server", "--listen", "stdio://"], { ...options, stdio: ["pipe", "pipe", "pipe"] });
const pending = new Map(), calls = [];
let nextId = 0, buffer = "", stderr = "", failure = null;
child.stderr.on("data", data => { stderr = (stderr + data).slice(-4000); });
child.stdout.setEncoding("utf8");
child.stdout.on("data", data => {
  buffer += data; let end;
  while ((end = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1); if (!line) continue;
    let message; try { message = JSON.parse(line); } catch { continue; }
    if (message.id != null) pending.get(message.id)?.resolve(message);
  }
});
child.on("error", error => { for (const item of pending.values()) item.reject(error); });
child.on("exit", () => { for (const item of pending.values()) item.reject(Error("MCP config probe server exited")); });
async function rpc(method, params, allowError = false) {
  assert.ok(["initialize", "config/read", "configRequirements/read", "config/batchWrite", "config/value/write", "config/mcpServer/reload"].includes(method));
  const id = ++nextId; let timer;
  try {
    const response = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(Error(`${method} timed out`)), 20000);
      pending.set(id, { resolve, reject }); child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
    calls.push({ method, params, response });
    if (!allowError) assert.equal(response.error, undefined, `${method}: ${JSON.stringify(response.error)}`);
    return allowError ? response : response.result;
  } finally { clearTimeout(timer); pending.delete(id); }
}
try {
  await rpc("initialize", { clientInfo: { name: "codex-mcp-settings-b-probe", version: "0.1.0" }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} }) + "\n");
  const read = () => rpc("config/read", { includeLayers: true, cwd: null });
  const user = data => data.layers.find(layer => layer.name.type === "user" && !layer.name.profile && !layer.disabledReason);
  const start = await read(), initial = user(start);
  assert.ok(initial?.name.file && initial.version);
  assert.equal(path.resolve(initial.name.file), path.resolve(configFile));
  const preserved = structuredClone(initial.config.mcp_servers);
  const name = String.raw`fixture.name"quoted\path`;
  const mapKey = String.raw`header.key"quoted\name`;
  const key = `"mcp_servers".${JSON.stringify(name)}`;
  let snapshot = start;
  const write = async edits => {
    const current = user(snapshot);
    await rpc("config/batchWrite", { edits, filePath: current.name.file, expectedVersion: current.version, reloadUserConfig: false });
    snapshot = await read(); return user(snapshot).config.mcp_servers;
  };
  let servers = await write([{ keyPath: key, value: { command: "fixture-never-launch", args: ["one arg", "中文"], enabled: false, env: { "A.B": "original" } }, mergeStrategy: "replace" }]);
  assert.equal(servers[name].env["A.B"], "original");
  const direct = await rpc("config/value/write", { keyPath: `mcp_servers.${JSON.stringify(name)}.enabled`, value: false,
    mergeStrategy: "upsert", filePath: null, expectedVersion: null });
  assert.equal(path.resolve(direct.filePath), path.resolve(configFile), "management toggle writes the private default user file");
  snapshot = await read();
  assert.equal(user(snapshot).config.mcp_servers[name].enabled, false);
  assert.equal(user(snapshot).config.mcp_servers.fixture, undefined, "literal dotted server name does not create a nested server");
  servers = await write([{ keyPath: `${key}.env.${JSON.stringify(mapKey)}`, value: "literal", mergeStrategy: "replace" }]);
  assert.equal(servers[name].env[mapKey], "literal");
  assert.ok(snapshot.origins[`mcp_servers.${name}.env.${mapKey}`], "origins flatten literal names without quoted path escaping");
  servers = await write([{ keyPath: `${key}.env.${JSON.stringify("A.B")}`, value: null, mergeStrategy: "replace" }]);
  assert.equal(servers[name].env["A.B"], undefined);
  assert.equal(servers[name].env[mapKey], "literal");
  for (const [server, value] of Object.entries(preserved)) assert.deepEqual(servers[server], value, `unrelated server ${server} retained`);
  const stale = await rpc("config/batchWrite", { edits: [{ keyPath: `${key}.enabled`, value: true, mergeStrategy: "replace" }], filePath: initial.name.file, expectedVersion: initial.version }, true);
  assert.equal(stale.error?.data?.config_write_error_code, "configVersionConflict");
  assert.equal(user(await read()).config.mcp_servers[name].enabled, false);
  const reload = await rpc("config/mcpServer/reload", {}); assert.ok(reload && typeof reload === "object");
  servers = await write([{ keyPath: key, value: null, mergeStrategy: "replace" }]);
  assert.equal(servers[name], undefined); assert.deepEqual(servers, preserved);
  assert.match(fs.readFileSync(configFile, "utf8"), /# MCP fixture heading/);
  console.log("PASS isolated MCP config: default-file value/upsert with literal server key, quoted map keys, null removal, hidden/HTTP/unknown siblings, CAS conflict and explicit reload response; zero turns, disabled servers");
} catch (error) { failure = String(error); process.exitCode = 1; console.error(error); }
finally {
  if (child.exitCode == null) await new Promise(resolve => {
    const timer = setTimeout(() => { child.kill(); resolve(); }, 3000); child.once("exit", () => { clearTimeout(timer); resolve(); }); child.stdin.end();
  });
  const directory = process.env.MCP_SETTINGS_EVIDENCE_DIR || ".ref/parity/16.10/actual/16-10B/protocol";
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "mcp-settings-protocol.json"), JSON.stringify({ version: version.stdout.trim(), isolatedHome: home, calls, failure, stderr, modelTurns: 0 }, null, 2));
}
