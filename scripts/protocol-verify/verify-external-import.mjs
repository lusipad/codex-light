// Real external import in an isolated CODEX_HOME and temporary workspace; no real user files or model turns.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-import-settings-"));
const binary = process.env.CODEX_CLI_PATH || (process.platform === "win32" ? "codex.cmd" : "codex");
const options = {
  shell: binary.endsWith(".cmd"), windowsHide: true,
  env: { ...process.env, CODEX_HOME: home, OPENAI_API_KEY: "", CODEX_API_KEY: "" },
};
const version = spawnSync(binary, ["--version"], { ...options, encoding: "utf8" });
assert.equal(version.status, 0, version.stderr);
const existingPreferences = { desktopPreferences: { customPersonaPrompt: "preserve", unrelated: 42 }, "electron-persisted-atom-state": { neighbor: "keep" } };
fs.writeFileSync(path.join(home, ".codex-global-state.json"), JSON.stringify(existingPreferences));
const workspace = path.join(home, "workspace");
fs.mkdirSync(workspace);
fs.writeFileSync(path.join(workspace, "CLAUDE.md"), "# Isolated import fixture\nPreserve IMPORT_PARITY_SENTINEL in documentation.\n");
const child = spawn(binary, ["app-server", "--listen", "stdio://"], { ...options, stdio: ["pipe", "pipe", "pipe"] });
const pending = new Map(), calls = [], notifications = [], completed = new Map();
let completionResolve;
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
    if (message.method?.startsWith("externalAgentConfig/import/")) {
      notifications.push(message);
      if (message.method.endsWith("/completed")) {
        completed.set(message.params.importId, message.params);
        completionResolve?.(message.params);
      }
    }
  }
});
child.on("error", error => { for (const item of pending.values()) item.reject(error); });
child.on("exit", () => { for (const item of pending.values()) item.reject(Error("app-server exited before response")); });
async function rpc(method, params) {
  assert.ok(["initialize", "externalAgentConfig/detect", "externalAgentConfig/import", "fs/readFile", "fs/getMetadata"].includes(method), "probe is restricted to isolated config verification");
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
  const detection = await rpc("externalAgentConfig/detect", {includeHome:false,cwds:[workspace]});
  assert.ok(Array.isArray(detection.items));
  const item = detection.items.find(item => item.itemType === "AGENTS_MD" && path.resolve(item.cwd || "") === path.resolve(workspace));
  assert.ok(item, "isolated CLAUDE.md must be detected");
  const result = await rpc("externalAgentConfig/import", {migrationItems:[item],providerId:"claude-code",source:"app"});
  assert.equal(typeof result.importId, "string");
  let completion = completed.get(result.importId);
  if (!completion) {
    let timer;
    try {
      completion = await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(Error("completion timeout")), 20000);
        completionResolve = params => { if (params.importId === result.importId) resolve(params); };
      });
    } finally { clearTimeout(timer); completionResolve = null; }
  }
  assert.ok(Array.isArray(completion.itemTypeResults));
  assert.equal(completion.itemTypeResults.flatMap(result => result.failures).length, 0);
  const success = completion.itemTypeResults.flatMap(result => result.successes).find(result => result.itemType === "AGENTS_MD");
  assert.ok(success?.target);
  const target = path.resolve(success.target);
  assert.ok(target.startsWith(path.resolve(home) + path.sep), "import must stay inside fixture");
  const metadata = await rpc("fs/getMetadata", {path:target});
  assert.equal(metadata.isFile, true);
  const file = await rpc("fs/readFile", {path:target});
  const imported = Buffer.from(file.dataBase64, "base64").toString("utf8");
  assert.equal(imported, fs.readFileSync(target, "utf8"));
  assert.ok(imported.includes("IMPORT_PARITY_SENTINEL"));
  assert.ok(fs.readFileSync(path.join(workspace, "CLAUDE.md"), "utf8").includes("IMPORT_PARITY_SENTINEL"));
  const preferencesAfter = JSON.parse(fs.readFileSync(path.join(home, ".codex-global-state.json"), "utf8"));
  assert.deepEqual(preferencesAfter.desktopPreferences, existingPreferences.desktopPreferences);
  assert.deepEqual(preferencesAfter["electron-persisted-atom-state"], existingPreferences["electron-persisted-atom-state"]);
  console.log("PASS real external detection/import/completed and target-file readback in isolated workspace; zero model turns");

} catch (error) {
  failure = String(error); process.exitCode = 1; console.error(error);
} finally {
  if (child.exitCode == null) await new Promise(resolve => {
    const timer = setTimeout(() => { child.kill(); resolve(); }, 3000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    child.stdin.end();
  });
  const directory = ".ref/parity/16.17/actual";
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "protocol-external-import.json"), JSON.stringify({
    version: version.stdout.trim(), isolatedHome: home, calls, notifications, failure, errorOutput, modelTurns: 0,
  }, null, 2));
}
