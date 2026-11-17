// Real CLI config only, in a fresh private CODEX_HOME. Never authenticates or creates a turn.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const temporaryRoot = fs.realpathSync(os.tmpdir());
const home = fs.mkdtempSync(path.join(temporaryRoot, "codex-appshots-settings-"));
assert.equal(path.dirname(home), temporaryRoot);
assert.notEqual(path.resolve(home), path.resolve(process.env.CODEX_HOME || os.homedir()));
const configFile = path.join(home, "config.toml");
const sentinel = '# Appshots probe: preserve this comment\ndeveloper_instructions = "isolated appshots sentinel"\n';
fs.writeFileSync(configFile, sentinel);
const binary = process.env.CODEX_CLI_PATH || (process.platform === "win32" ? "codex.cmd" : "codex");
const options = { shell: binary.endsWith(".cmd"), windowsHide: true,
  cwd: home, env: { ...process.env, CODEX_HOME: home, OPENAI_API_KEY: "", CODEX_API_KEY: "" } };
const version = spawnSync(binary, ["--version"], { ...options, encoding: "utf8" });
let child, buffer = "", stderr = "", nextId = 0, failure = null, passed = false;
const calls = [], observations = [], pending = new Map();
const exit = { code: null, signal: null, forced: false, observed: false };
function launch() {
  child = spawn(binary, ["app-server", "--listen", "stdio://"], { ...options, stdio: ["pipe", "pipe", "pipe"] });
  child.stderr.on("data", value => { stderr = (stderr + value).slice(-8000); });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", value => {
    buffer += value; let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1); if (!line) continue;
      try { const message = JSON.parse(line); if (message.id != null) pending.get(message.id)?.resolve(message); }
      catch (error) { for (const item of pending.values()) item.reject(error); }
    }
  });
  child.on("error", error => { for (const item of pending.values()) item.reject(error); });
  child.on("exit", (code, signal) => {
    Object.assign(exit, { code, signal, observed: true });
    for (const item of pending.values()) item.reject(Error("app-server exited before response"));
  });
}
async function rpc(method, params) {
  assert.ok(["initialize", "config/read", "config/batchWrite"].includes(method), "config-only probe allowlist");
  if (method === "config/batchWrite") {
    assert.equal(fs.realpathSync(home), home); assert.equal(options.env.CODEX_HOME, home);
    assert.equal(fs.lstatSync(home).isSymbolicLink(), false);
    assert.equal(params.filePath, configFile, "never mutate any outside config file");
    assert.ok(params.edits.every(edit => edit.keyPath === "desktop.appshotDestination"
      && ["automatic", "last-chat", "new-chat"].includes(edit.value) && edit.mergeStrategy === "replace"));
  }
  const id = ++nextId; let timer;
  try {
    const response = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(Error(`${method} timeout`)), 20000);
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
    calls.push({ method, params, response });
    if (response.error) throw Error(`${method}: ${JSON.stringify(response.error)}`);
    return response.result;
  } finally { clearTimeout(timer); pending.delete(id); }
}
const read = () => rpc("config/read", { includeLayers: true, cwd: null });
function user(snapshot) {
  const layer = snapshot.layers.findLast(value => value.name.type === "user" && !value.name.profile);
  assert.ok(layer?.name.file && layer.version, "real user layer/file/version required");
  assert.equal(fs.realpathSync(layer.name.file), fs.realpathSync(configFile));
  return layer;
}
const write = (value, snapshot) => rpc("config/batchWrite", {
  edits: [{ keyPath: "desktop.appshotDestination", value, mergeStrategy: "replace" }],
  filePath: configFile, expectedVersion: user(snapshot).version, reloadUserConfig: true,
});
function check(snapshot, destination) {
  const layer = user(snapshot), toml = fs.readFileSync(configFile, "utf8");
  assert.equal(snapshot.config.desktop.appshotDestination, destination, "effective config consumes actual destination");
  assert.equal(layer.config.desktop.appshotDestination, destination, "user layer persists destination");
  assert.equal(layer.config.developer_instructions, "isolated appshots sentinel");
  assert.equal(snapshot.config.developer_instructions, "isolated appshots sentinel");
  assert.match(toml, /# Appshots probe: preserve this comment/);
  assert.match(toml, /\[desktop\]/);
  assert.match(toml, new RegExp(`appshotDestination\\s*=\\s*"${destination}"`));
  observations.push({ destination, userFile: layer.name.file, userVersion: layer.version, toml });
}
async function stop() {
  if (!child || exit.observed) return;
  await new Promise((resolve, reject) => {
    const force = setTimeout(() => { exit.forced = true; child.kill(); }, 3000);
    const deadline = setTimeout(() => { clearTimeout(force); reject(Error("app-server did not exit after kill")); }, 6000);
    child.once("exit", () => { clearTimeout(force); clearTimeout(deadline); resolve(); });
    child.stdin.end();
  });
}
try {
  assert.equal(version.status, 0, version.stderr || String(version.error));
  launch();
  await rpc("initialize", { clientInfo: { name: "codex-native-appshots-settings-probe", version: "0.1.0" }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
  const initial = await read();
  observations.push({ name: "unconfigured-desktop", hasEffectiveDesktop: Object.hasOwn(initial.config, "desktop"),
    effectiveDesktop: initial.config.desktop, userConfig: user(initial).config, userVersion: user(initial).version });
  assert.equal(initial.config.desktop, null, "record current real CLI unconfigured desktop shape");
  assert.equal(user(initial).config.desktop, undefined);
  let current = initial;
  for (const value of ["automatic", "last-chat", "new-chat"]) {
    assert.equal((await write(value, current)).status, "ok");
    current = await read(); check(current, value);
  }
  assert.equal((await write("new-chat", current)).status, "ok", "same-value destination writes remain accepted");
  current = await read(); check(current, "new-chat");
  const beforeConflict = fs.readFileSync(configFile, "utf8");
  await assert.rejects(() => write("last-chat", initial), /version|conflict|changed/i);
  const afterConflict = await read(); check(afterConflict, "new-chat");
  assert.equal(fs.readFileSync(configFile, "utf8"), beforeConflict, "stale version cannot mutate disk");
  assert.deepEqual(user(afterConflict).config, user(current).config, "stale write preserves all user fields");
  passed = true;
} catch (error) { failure = String(error?.stack || error); process.exitCode = 1; console.error(error); }
finally {
  try { await stop(); if (child) assert.equal(exit.observed, true); }
  catch (error) { passed = false; failure = [failure, String(error?.stack || error)].filter(Boolean).join("\n"); process.exitCode = 1; console.error(error); }
  const output = process.env.APPSHOTS_SETTINGS_PROBE_OUTPUT || ".ref/parity/16/appshots-b4-settings-r3-20261117/protocol/protocol-appshots-settings.json";
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ capturedAt: new Date().toISOString(), binary, version: version.stdout?.trim(),
    versionExitCode: version.status, isolatedHome: home, passed, failure, exit, observations, calls, stderr,
    modelTurns: 0, scope: "isolated real CLI config/layer/version/disk only; not official settingsStore filtering, native registration, UI or account service" }, null, 2));
}
if (passed) console.log(`PASS ${version.stdout.trim()}: real isolated Appshots destination automatic/last-chat/new-chat, same-value write, effective/user layer + TOML, stale CAS rejection, sentinel preservation, child exit; zero model turns.`);
