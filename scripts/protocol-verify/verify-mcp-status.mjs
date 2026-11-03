// Read-only discovery in an isolated CODEX_HOME; never authenticates or creates a turn.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-mcp-status-"));
const fixture = path.join(home, "mcp-fixture.cjs");
fs.writeFileSync(fixture, `const readline = require("node:readline");
readline.createInterface({input:process.stdin}).on("line", line => {
 const request = JSON.parse(line); if (request.id == null) return;
 let result = request.method === "initialize" ? {protocolVersion:"2024-11-05",capabilities:{tools:{},resources:{}},serverInfo:{name:"parity-fixture",version:"1.0"}}
 : request.method === "tools/list" ? {tools:[{name:"parity_probe",description:"Offline fixture tool",inputSchema:{type:"object",properties:{}}}]}
 : request.method === "resources/list" ? {resources:[]}
 : request.method === "resources/templates/list" ? {resourceTemplates:[]} : {};
 process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:request.id,result})+"\\n");
});`);
fs.writeFileSync(path.join(home, "config.toml"), `[mcp_servers.parity_fixture]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(fixture)}]\n`);
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
  assert.ok(["initialize", "mcpServerStatus/list"].includes(method), "probe is restricted to isolated MCP fixture discovery");
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
    clientInfo: { name: "codex-native-mcp-status-probe", version: "0.1.0" },
    capabilities: { experimentalApi: true },
  });
  const page = await rpc("mcpServerStatus/list", { serverName: "parity_fixture", cursor: null, limit: 1, detail: "full" });
  assert.ok(Array.isArray(page.data));
  const status = page.data.find(row => row.name === "parity_fixture");
  assert.ok(status, "configured fixture must be discovered");
  assert.equal(status.serverInfo?.name, "parity-fixture");
  assert.ok(status.tools.parity_probe);
  assert.equal(status.toolsError ?? null, null);
  assert.ok([null, undefined, "connected"].includes(status.runtimeStatus));
  console.log("PASS real MCP stdio fixture initialized, advertised tool discovered; no external service or model turns");
} catch (error) {
  failure = String(error); process.exitCode = 1; console.error(error);
} finally {
  if (child.exitCode == null) await new Promise(resolve => {
    const timer = setTimeout(() => { child.kill(); resolve(); }, 3000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    child.stdin.end();
  });
  const directory = ".ref/parity/16.10/runs/20261101-codex-mcp-status/actual";
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "protocol-mcp-status.json"), JSON.stringify({
    version: version.stdout.trim(), isolatedHome: home, calls, failure, errorOutput, modelTurns: 0,
  }, null, 2));
}
