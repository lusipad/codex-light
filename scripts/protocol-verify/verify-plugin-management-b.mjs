// Real, zero-turn local lifecycle in a fresh CODEX_HOME. No real account/plugin mutation.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-plugin-management-b-"));
const home = path.join(directory, "home"), workspace = path.join(directory, "workspace"), market = path.join(directory, "market");
const marketplacePath = path.join(market, ".agents", "plugins", "marketplace.json");
const marketplaceName = "private-management-market";
const names = ["private-first", "private-second"];
for (const location of [home, workspace, path.dirname(marketplacePath)]) fs.mkdirSync(location, { recursive: true });
for (const name of names) {
  const root = path.join(market, "plugins", name);
  fs.mkdirSync(path.join(root, ".codex-plugin"), { recursive: true });
  fs.writeFileSync(path.join(root, ".codex-plugin", "plugin.json"), JSON.stringify({ name, version: "1.0.0", description: "Private management fixture" }));
}
fs.writeFileSync(marketplacePath, JSON.stringify({ name: marketplaceName, owner: { name: "Local fixture" }, plugins: names.map(name => ({ name, source: { source: "local", path: `./plugins/${name}` } })) }));
const configFile = path.join(home, "config.toml");
fs.writeFileSync(configFile, '# Private fixture heading\n[plugins.sibling]\nenabled = false\nunknown_fixture = "preserve"\n');
const binary = process.env.CODEX_CLI_PATH || (process.platform === "win32" ? "codex.cmd" : "codex");
const options = { cwd: workspace, shell: binary.endsWith(".cmd"), windowsHide: true, env: { ...process.env, CODEX_HOME: home, OPENAI_API_KEY: "", CODEX_API_KEY: "" } };
const version = spawnSync(binary, ["--version"], { ...options, encoding: "utf8" });
assert.equal(version.status, 0, version.stderr);
const child = spawn(binary, ["app-server", "--listen", "stdio://"], { ...options, stdio: ["pipe", "pipe", "pipe"] });
let nextId = 0, buffer = "", stderr = "", failure = null;
const pending = new Map(), calls = [], checks = [];
child.stderr.on("data", data => { stderr = (stderr + data).slice(-6000); });
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
child.on("exit", () => { for (const item of pending.values()) item.reject(Error("server exited")); });
async function rpc(method, params, allowError = false) {
  assert.notEqual(method, "turn/start");
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
const check = message => { checks.push(message); console.log(`PASS ${message}`); };
try {
  await rpc("initialize", { clientInfo: { name: "codex-plugin-management-b-probe", version: "0.1.0" }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} }) + "\n");
  const read = () => rpc("config/read", { includeLayers: true, cwd: workspace });
  const user = data => data.layers.filter(layer => layer.name.type === "user" && !layer.name.profile && !layer.disabledReason).at(-1);
  const installed = () => rpc("plugin/installed", { cwds: [workspace] });
  const rows = result => { assert.deepEqual(result.marketplaceLoadErrors ?? [], []); return result.marketplaces.flatMap(item => item.plugins); };
  await rpc("marketplace/add", { source: market });
  const configured = await read();
  assert.ok(configured.config.marketplaces[marketplaceName]);
  assert.equal(configured.config.marketplaces[marketplaceName].source_type, "local");
  check("private marketplace configuration exposes real source_type=local");
  const catalog = await rpc("plugin/list", { cwds: [workspace], marketplaceKinds: ["local"] });
  const fixtures = rows(catalog).filter(plugin => names.includes(plugin.name));
  assert.equal(fixtures.length, 2);
  for (const fixture of fixtures) await rpc("plugin/install", { pluginName: fixture.name, marketplacePath, installAttemptId: `fixture-${fixture.name}` });
  assert.equal(rows(await installed()).filter(plugin => fixtures.some(item => item.id === plugin.id)).length, 2);
  let snapshot = await read();
  const originalSibling = structuredClone(user(snapshot).config.plugins.sibling);
  const fixture = fixtures[0];
  for (const enabled of [false, true]) {
    const layer = user(snapshot);
    await rpc("config/batchWrite", { edits: [{ keyPath: `plugins.${JSON.stringify(fixture.id)}.enabled`, value: enabled, mergeStrategy: "upsert" }], filePath: layer.name.file, expectedVersion: layer.version, reloadUserConfig: true });
    snapshot = await read();
    assert.equal(user(snapshot).config.plugins[fixture.id].enabled, enabled);
    assert.equal(rows(await installed()).find(plugin => plugin.id === fixture.id)?.enabled, enabled);
    assert.deepEqual(user(snapshot).config.plugins.sibling, originalSibling);
    const skills = await rpc("skills/list", { cwds: [workspace], forceReload: true });
    assert.ok(Array.isArray(skills.data));
  }
  check("local toggle user CAS/readback, installed enabled, skills forceReload and sibling preservation");
  const stale = await rpc("config/batchWrite", { edits: [{ keyPath: `plugins.${JSON.stringify(fixture.id)}.enabled`, value: false, mergeStrategy: "upsert" }], filePath: user(configured).name.file, expectedVersion: user(configured).version, reloadUserConfig: true }, true);
  assert.equal(stale.error?.data?.config_write_error_code, "configVersionConflict");
  check("stale enabled write rejected by real version conflict");
  // The complete installed enumeration is checked before any destructive action.
  const removal = (await installed()).marketplaces.filter(item => item.name === marketplaceName).flatMap(item => item.plugins).filter(plugin => plugin.installed);
  assert.equal(removal.length, 2); assert.ok(removal.every(plugin => plugin.installPolicy !== "INSTALLED_BY_DEFAULT"));
  for (const plugin of removal) {
    await rpc("plugin/uninstall", { pluginId: plugin.id });
    assert.equal(rows(await installed()).some(item => item.id === plugin.id), false);
  }
  assert.equal((await installed()).marketplaces.filter(item => item.name === marketplaceName).flatMap(item => item.plugins).filter(plugin => plugin.installed).length, 0);
  await rpc("marketplace/remove", { marketplaceName });
  assert.equal((await read()).config.marketplaces?.[marketplaceName], undefined);
  assert.equal((await installed()).marketplaces.some(item => item.name === marketplaceName), false);
  assert.match(fs.readFileSync(configFile, "utf8"), /# Private fixture heading/);
  check("full enumeration then sequential verified uninstall, final empty check and verified marketplace removal");
} catch (error) { failure = String(error?.stack || error); process.exitCode = 1; console.error(error); }
finally {
  if (child.exitCode == null) await new Promise(resolve => {
    const timer = setTimeout(() => { child.kill(); resolve(); }, 3000); child.once("exit", () => { clearTimeout(timer); resolve(); }); child.stdin.end();
  });
  const evidence = process.env.PLUGIN_MANAGEMENT_EVIDENCE_DIR || ".ref/parity/16.11/actual/16-11B/protocol";
  fs.mkdirSync(evidence, { recursive: true });
  fs.writeFileSync(path.join(evidence, "plugin-management-protocol.json"), JSON.stringify({ version: version.stdout.trim(), isolatedHome: home, calls, checks, failure, stderr, modelTurns: 0 }, null, 2));
}
