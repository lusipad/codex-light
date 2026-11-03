// Real local plugin lifecycle in a private CODEX_HOME. No authentication or model turn.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-plugin-preparation-"));
const home = path.join(directory, "home");
const workspace = path.join(directory, "workspace");
const marketRoot = path.join(directory, "market");
const pluginRoot = path.join(marketRoot, "plugins", "offline-preparation");
const marketFile = path.join(marketRoot, ".agents", "plugins", "marketplace.json");
for (const location of [home, workspace, path.dirname(marketFile), path.join(pluginRoot, ".codex-plugin")]) {
  fs.mkdirSync(location, { recursive: true });
}
fs.writeFileSync(path.join(pluginRoot, ".codex-plugin", "plugin.json"), JSON.stringify({
  name: "offline-preparation", version: "1.0.0", description: "Private offline lifecycle fixture.",
}));
fs.writeFileSync(marketFile, JSON.stringify({
  name: "offline-preparation-market",
  owner: { name: "Local test" },
  plugins: [{ name: "offline-preparation", source: { source: "local", path: "./plugins/offline-preparation" } }],
}));
const binary = process.env.CODEX_CLI_PATH || (process.platform === "win32" ? "codex.cmd" : "codex");
const options = {
  shell: binary.endsWith(".cmd"), windowsHide: true, cwd: workspace,
  env: { ...process.env, CODEX_HOME: home, OPENAI_API_KEY: "", CODEX_API_KEY: "" },
};
const version = spawnSync(binary, ["--version"], { ...options, encoding: "utf8" });
assert.equal(version.status, 0, version.stderr);
const schemaDir = path.join(directory, "schema");
const generated = spawnSync(binary, ["app-server", "generate-json-schema", "--out", schemaDir], {
  ...options, encoding: "utf8", timeout: 30000,
});
assert.equal(generated.status, 0, generated.stderr);
const schemaFiles = [
  "PluginInstallParams", "PluginInstallResponse", "PluginInstalledResponse", "PluginReadResponse",
  "AppsListParams", "AppsListResponse", "AppsInstalledParams", "AppsInstalledResponse",
  "AppsReadParams", "AppsReadResponse",
];
const schemas = {};
for (const name of schemaFiles) {
  const file = path.join(schemaDir, "v2", `${name}.json`);
  if (!fs.existsSync(file)) { schemas[name] = { available: false }; continue; }
  const bytes = fs.readFileSync(file);
  const schema = JSON.parse(bytes);
  schemas[name] = {
    available: true, sha256: createHash("sha256").update(bytes).digest("hex"),
    required: schema.required || [], properties: schema.properties,
    definitions: Object.fromEntries(Object.entries(schema.definitions || {}).filter(([key]) =>
      /^(AppInfo|AppRuntime|AppSummary|AppMetadata|AppAvailability|InstalledApp|ConnectorMetadata|PluginAuthPolicy)/.test(key))),
  };
}
assert.deepEqual(schemas.PluginInstallResponse.required, ["appsNeedingAuth", "authPolicy"]);
assert.deepEqual(schemas.PluginInstallResponse.definitions.PluginAuthPolicy.enum, ["ON_INSTALL", "ON_USE"]);
assert.deepEqual(Object.keys(schemas.AppsListParams.properties).sort(), ["cursor", "forceRefetch", "limit", "threadId"]);
assert.equal(schemas.AppsListResponse.definitions.AppInfo.properties.isAccessible.type, "boolean");
assert.deepEqual(schemas.AppsInstalledResponse.definitions.InstalledApp.required, ["callable", "enabled", "id"]);
assert.equal(schemas.AppsInstalledParams.properties.forceRefresh.type, "boolean");
assert.deepEqual(schemas.AppsReadParams.required, ["appIds"]);
assert.equal(schemas.AppsReadParams.properties.appIds.type, "array");
// The generated schemas document the 100-id limit in prose, not a maxItems constraint.
assert.match(schemas.AppsReadParams.properties.appIds.description, /at most 100 ids/);
assert.deepEqual(schemas.AppsReadResponse.required, ["apps", "missingAppIds"]);
let child, buffer = "", nextId = 0, stderr = "", passed = false, failure = null;
const pending = new Map(), transcript = [], notifications = [], checks = [];
const connectorReads = {};
function rpc(method, params) {
  assert.notEqual(method, "turn/start");
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} timed out`)); }, 20000);
    pending.set(id, response => {
      clearTimeout(timer);
      pending.delete(id);
      transcript.push({ method, params, response });
      resolve(response);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
async function request(method, params) {
  const response = await rpc(method, params);
  assert.equal(response.error, undefined, `${method}: ${JSON.stringify(response.error)}`);
  return response.result;
}
async function stop() {
  if (!child || child.exitCode != null) return;
  await new Promise(resolve => { child.once("exit", resolve); child.stdin.end(); });
}
function check(name) { checks.push(name); console.log(`PASS ${name}`); }
function rows(response) {
  assert.ok(Array.isArray(response.marketplaces));
  assert.deepEqual(response.marketplaceLoadErrors || [], []);
  return response.marketplaces.flatMap(market => market.plugins);
}
try {
  child = spawn(binary, ["app-server", "--listen", "stdio://"], { ...options, stdio: ["pipe", "pipe", "pipe"] });
  child.stderr.on("data", data => { stderr = (stderr + data).slice(-8000); });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", data => {
    buffer += data;
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message.id != null) pending.get(message.id)?.(message);
      else if (message.method) notifications.push(message);
    }
  });
  await request("initialize", {
    clientInfo: { name: "codex-native-plugin-preparation-probe", version: "0.1.0" },
    capabilities: { experimentalApi: true },
  });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} }) + "\n");
  for (const [method, params, resultKeys] of [
    ["app/installed", { forceRefresh: true }, ["apps"]],
    ["app/read", { appIds: [] }, ["apps", "missingAppIds"]],
  ]) {
    const response = await rpc(method, params);
    if (response.error) {
      const missingMethod = response.error.code === -32601 ||
        (response.error.code === -32600 && /unknown (variant|method)/i.test(response.error.message || ""));
      connectorReads[method] = { supported: false, fallbackEligible: missingMethod, error: response.error };
      assert.ok(missingMethod, `${method}: unexpected non-compatibility error ${JSON.stringify(response.error)}`);
      check(`${method} unavailable with explicit method-not-supported fallback evidence`);
    } else {
      for (const key of resultKeys) assert.ok(Array.isArray(response.result[key]), `${method}.${key} must be an array`);
      if (method === "app/read") assert.deepEqual(response.result, { apps: [], missingAppIds: [] });
      connectorReads[method] = { supported: true, fallbackEligible: false };
      check(`${method} real isolated read accepted ${JSON.stringify(params)}`);
    }
  }
  await request("marketplace/add", { source: marketRoot });
  const catalog = await request("plugin/list", { cwds: [workspace], marketplaceKinds: ["local"] });
  const fixture = rows(catalog).find(item => item.name === "offline-preparation");
  assert.ok(fixture, "private marketplace fixture must be discoverable");
  assert.equal(fixture.installed, false);
  assert.equal(rows(await request("plugin/installed", { cwds: [workspace] })).some(item => item.id === fixture.id), false);
  check("private marketplace registered; fixture initially absent from installed list");
  const ref = { marketplacePath: marketFile, pluginName: fixture.name };
  const installed = await request("plugin/install", { ...ref, installAttemptId: "offline-preparation-probe" });
  assert.ok(["ON_INSTALL", "ON_USE"].includes(installed.authPolicy));
  assert.deepEqual(installed.appsNeedingAuth, []);
  check("real installation reports explicit auth policy and zero app requirements");
  const installedRow = rows(await request("plugin/installed", { cwds: [workspace] })).find(item => item.id === fixture.id);
  assert.equal(installedRow?.installed, true);
  const detail = await request("plugin/read", ref);
  assert.equal(detail.plugin.summary.id, fixture.id);
  assert.equal(detail.plugin.summary.installed, true);
  assert.deepEqual(detail.plugin.apps, []);
  check("installed list and plugin detail independently confirm real installation");
  await request("plugin/uninstall", { pluginId: fixture.id });
  assert.equal(rows(await request("plugin/installed", { cwds: [workspace] })).some(item => item.id === fixture.id), false);
  assert.equal((await request("plugin/read", ref)).plugin.summary.installed, false);
  check("real uninstall removed installed row and detail confirms uninstalled");
  assert.ok(!transcript.some(item => item.method === "turn/start"));
  assert.ok(!notifications.some(event => event.method === "turn/started"));
  check("zero model turns; no real home or account required");
  passed = true;
} catch (error) {
  failure = String(error?.stack || error);
  process.exitCode = 1;
} finally {
  await stop();
  const output = process.env.PLUGIN_PREPARATION_PROBE_OUTPUT || ".ref/protocol-probe/plugin-preparation.json";
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({
    capturedAt: new Date().toISOString(), binary, version: version.stdout.trim(), isolatedHome: home,
    fixtureDirectory: directory, passed, failure, checks, schemas, connectorReads, transcript, notifications, stderr,
    scope: "real isolated no-app plugin lifecycle and CLI schema; not OAuth, official UI, native links, or pixel parity",
  }, null, 2));
  console.log(`Evidence: ${output}`);
  if (failure) console.error(failure);
}
