// All mutations are restricted to a newly created temporary CODEX_HOME. Zero model turns.
// Artifact roots: OpenAI/codex commit 29eed280828d498fead76c3c5dedd9642836b571,
// codex-rs/protocol/src/memory_version.rs and app-server/tests/suite/v2/memory_reset.rs.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const temporaryRoot = fs.realpathSync(os.tmpdir());
const home = fs.mkdtempSync(path.join(temporaryRoot, "codex-memory-preferences-"));
assert.equal(path.dirname(home), temporaryRoot);
assert.ok(path.basename(home).startsWith("codex-memory-preferences-"));
assert.notEqual(path.resolve(home), path.resolve(process.env.CODEX_HOME || os.homedir()));
function fixture(relative) {
  const target = path.resolve(home, relative);
  assert.ok(target.startsWith(home + path.sep), "fixture must stay inside the newly created home");
  if (fs.existsSync(target)) assert.ok(!fs.lstatSync(target).isSymbolicLink(), "fixture target must not be a link");
  for (let cursor = path.dirname(target); cursor.length >= home.length; cursor = path.dirname(cursor)) {
    if (fs.existsSync(cursor)) assert.ok(!fs.lstatSync(cursor).isSymbolicLink(), "fixture must not traverse a link");
    if (cursor === home) break;
  }
  return target;
}
function writeFixture(relative, contents) {
  const target = fixture(relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, contents); return target;
}
const configFile = writeFixture("config.toml", '# fixture: preserve this comment\ndeveloper_instructions = "isolated memory probe sentinel"\n\n[features]\nmemories = false\nchronicle = true\n\n[memories]\nno_memories_if_mcp_or_web_search = true\n');
const keepFiles = ["fixture-project/keep.txt", "AGENTS.md", "memories_backup/keep.txt", "sessions/probe-preserved.jsonl"];
for (const relative of keepFiles) writeFixture(relative, `must survive memory/reset: ${relative}\n`);
const sentinels = keepFiles.map(relative => ({ relative, contents: fs.readFileSync(fixture(relative), "utf8") }));
const binary = process.env.CODEX_CLI_PATH || (process.platform === "win32" ? "codex.cmd" : "codex");
const options = { shell: binary.endsWith(".cmd"), windowsHide: true,
  env: { ...process.env, CODEX_HOME: home, OPENAI_API_KEY: "", CODEX_API_KEY: "" } };
const version = spawnSync(binary, ["--version"], { ...options, encoding: "utf8" });
assert.equal(version.status, 0, version.stderr);
let child, buffer = "", nextId = 0, launchCount = 0, stderr = "", failure = null, passed = false;
const pending = new Map(), calls = [], observations = [];
function launch() {
  launchCount += 1; buffer = "";
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
  child.on("exit", () => { for (const item of pending.values()) item.reject(Error("app-server exited before response")); });
}
async function stop() {
  if (!child || child.exitCode != null) return;
  await new Promise(resolve => { const timer = setTimeout(() => { child.kill(); resolve(); }, 3000); child.once("exit", () => { clearTimeout(timer); resolve(); }); child.stdin.end(); });
}
const readMethods = new Set(["initialize", "config/read", "experimentalFeature/list", "memory/status"]);
const mutationMethods = new Set(["config/batchWrite", "memory/reset"]);
async function rpc(method, params) {
  assert.ok(readMethods.has(method) || mutationMethods.has(method), `method outside probe allowlist: ${method}`);
  if (mutationMethods.has(method)) {
    assert.equal(fs.realpathSync(home), home, "temporary home identity changed");
    assert.equal(options.env.CODEX_HOME, home, "mutations must use the probe home");
    assert.ok(!fs.lstatSync(home).isSymbolicLink());
    if (method === "config/batchWrite") {
      assert.equal(params.filePath, configFile, "no external configuration targets");
      assert.ok(params.edits.every(edit => ["features.memories", "features.chronicle", "memories.generate_memories", "memories.use_memories", "memories.disable_on_external_context", "memories.no_memories_if_mcp_or_web_search"].includes(edit.keyPath)));
    } else assert.equal(params, null, "reset takes no external path or host input");
  }
  const id = ++nextId; let timer;
  try {
    const response = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(Error(`${method} timeout`)), 20000); pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
    calls.push({ process: launchCount, method, params, response });
    if (response.error) throw Error(`${method}: ${JSON.stringify(response.error)}`);
    return response.result;
  } finally { clearTimeout(timer); pending.delete(id); }
}
async function initialize() {
  launch(); await rpc("initialize", { clientInfo: { name: "codex-native-memory-preferences-probe", version: "0.1.0" }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
}
const read = () => rpc("config/read", { includeLayers: true, cwd: null });
function user(snapshot) {
  const layer = snapshot.layers.findLast(layer => layer.name.type === "user");
  assert.ok(layer); assert.equal(path.resolve(layer.name.file), configFile); assert.ok(layer.version); return layer;
}
async function features() {
  const all = [], cursors = new Set(); let cursor = null;
  do { const page = await rpc("experimentalFeature/list", { cursor, limit: 31 }); all.push(...page.data); cursor = page.nextCursor; assert.ok(!cursor || !cursors.has(cursor)); if (cursor) cursors.add(cursor); } while (cursor);
  return all;
}
async function batch(edits, snapshot = null) {
  const current = snapshot || await read();
  return rpc("config/batchWrite", { edits: edits.map(([keyPath, value]) => ({ keyPath, value, mergeStrategy: value === null ? "replace" : "upsert" })), filePath: configFile, expectedVersion: user(current).version, reloadUserConfig: true });
}
function checkMemory(snapshot, enabled, external) {
  const config = user(snapshot).config;
  assert.equal(config.features.memories, enabled);
  assert.equal(config.memories.generate_memories, enabled);
  assert.equal(config.memories.use_memories, enabled);
  if (external !== undefined) assert.equal(config.memories.disable_on_external_context, external);
  assert.equal(snapshot.config.memories.generate_memories, enabled, "effective config must read persisted memories");
  assert.equal(snapshot.config.memories.use_memories, enabled);
}
const memoryDatabases = ["memories_1.sqlite", "memories_v2_1.sqlite"];
let databaseEvidence = { verified: false, reason: "not attempted" };
async function seedDatabaseRows() {
  let DatabaseSync;
  try { ({ DatabaseSync } = await import("node:sqlite")); }
  catch { databaseEvidence = { verified: false, reason: "node:sqlite unavailable; file cleanup only, database row deletion remains unverified" }; console.warn(databaseEvidence.reason); return; }
  const threadId = randomUUID(), timestamp = Math.floor(Date.now() / 1000), schemas = [];
  for (const relative of memoryDatabases) {
    const target = fixture(relative); assert.ok(fs.existsSync(target), "real runtime must create its memory database");
    const db = new DatabaseSync(target);
    try {
      schemas.push({ relative, tables: db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='table' AND name IN ('stage1_outputs','jobs')").all() });
      db.prepare("INSERT INTO stage1_outputs(thread_id,source_updated_at,raw_memory,rollout_summary,generated_at) VALUES(?,?,?,?,?)").run(threadId, timestamp, "fixture raw memory", "fixture rollout summary", timestamp);
      const insertJob = db.prepare("INSERT INTO jobs(kind,job_key,status,retry_remaining) VALUES(?,?,?,?)");
      insertJob.run("memory_stage1", threadId, "done", 0);
      insertJob.run("memory_consolidate_global", "global", "done", 0);
      insertJob.run("probe_non_memory_job", threadId, "done", 0);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM stage1_outputs").get().n, 1);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM jobs").get().n, 3);
    } finally { db.close(); }
  }
  const db = new DatabaseSync(fixture("state_5.sqlite"));
  try {
    db.prepare("INSERT INTO threads(id,rollout_path,created_at,updated_at,source,model_provider,cwd,title,sandbox_policy,approval_mode,memory_mode) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run(threadId, fixture("sessions/probe-preserved.jsonl"), timestamp, timestamp, "cli", "probe", fixture("fixture-project"), "keep thread sentinel", "{}", "on-request", "enabled");
  } finally { db.close(); }
  databaseEvidence = { verified: false, seeded: true, threadId, schemas };
}
async function checkDatabaseRows() {
  if (!databaseEvidence.seeded) return;
  const { DatabaseSync } = await import("node:sqlite");
  const after = [];
  for (const relative of memoryDatabases) {
    const db = new DatabaseSync(fixture(relative), { readOnly: true });
    try {
      const stage1 = db.prepare("SELECT COUNT(*) AS n FROM stage1_outputs").get().n;
      const jobs = db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE kind IN ('memory_stage1','memory_consolidate_global')").get().n;
      const preserved = db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE kind='probe_non_memory_job'").get().n;
      assert.equal(stage1, 0); assert.equal(jobs, 0); assert.equal(preserved, 1);
      after.push({ relative, stage1, memoryJobs: jobs, preservedNonMemoryJobs: preserved });
    }
    finally { db.close(); }
  }
  const db = new DatabaseSync(fixture("state_5.sqlite"), { readOnly: true });
  try { assert.equal(db.prepare("SELECT memory_mode FROM threads WHERE id=?").get(databaseEvidence.threadId)?.memory_mode, "enabled", "reset must preserve thread metadata"); }
  finally { db.close(); }
  databaseEvidence = { ...databaseEvidence, verified: true, after };
}

try {
  await initialize();
  const initial = await read();
  assert.ok((await features()).some(feature => feature.name === "memories"), "runtime needs the real memories feature");
  await batch([["features.memories", true], ["memories.generate_memories", true], ["memories.use_memories", true]], initial);
  checkMemory(await read(), true);
  const cached = (await features()).find(feature => feature.name === "memories");
  observations.push({ name: "same-process-catalog-after-enable", feature: cached, matchesPersistedConfig: cached.enabled === true });
  await assert.rejects(() => batch([["features.memories", false]], initial), /version|conflict|changed/i);
  await batch([["memories.disable_on_external_context", false], ["memories.no_memories_if_mcp_or_web_search", null]]);
  let current = await read(); checkMemory(current, true, false);
  assert.equal(user(current).config.memories.no_memories_if_mcp_or_web_search, undefined);
  await stop(); await initialize();
  checkMemory(await read(), true, false);
  assert.equal((await features()).find(feature => feature.name === "memories").enabled, true, "fresh CLI must consume enabled memory feature");
  await batch([["memories.disable_on_external_context", true], ["memories.no_memories_if_mcp_or_web_search", null]]);
  checkMemory(await read(), true, true);
  await batch([["features.memories", false], ["memories.generate_memories", false], ["memories.use_memories", false], ["features.chronicle", false]]);
  current = await read(); checkMemory(current, false, true); assert.equal(user(current).config.features.chronicle, false);
  observations.push({ name: "same-process-catalog-after-disable", feature: (await features()).find(feature => feature.name === "memories") });
  await stop(); await initialize();
  checkMemory(await read(), false, true);
  assert.equal((await features()).find(feature => feature.name === "memories").enabled, false, "fresh CLI must consume disabled feature");
  await rpc("memory/status", {}); // Initializes real memory databases without generating a model turn.
  await stop();
  await seedDatabaseRows();
  for (const directory of ["memories", "memories_v2"]) {
    writeFixture(`${directory}/memory_summary.md`, "fixture memory summary\n");
    writeFixture(`${directory}/raw_memories.md`, "fixture raw memories\n");
    writeFixture(`${directory}/rollout_summaries/fixture.md`, "fixture rollout summary\n");
  }
  const beforeReset = fs.readFileSync(configFile, "utf8");
  await initialize();
  const reset = await rpc("memory/reset", null); assert.ok(reset && typeof reset === "object");
  for (const directory of ["memories", "memories_v2"]) {
    const target = fixture(directory); assert.deepEqual(fs.existsSync(target) ? fs.readdirSync(target) : [], [], `reset must remove seeded ${directory} artifacts`);
  }
  assert.equal(fs.readFileSync(configFile, "utf8"), beforeReset, "reset must not change preferences");
  for (const sentinel of sentinels) assert.equal(fs.readFileSync(fixture(sentinel.relative), "utf8"), sentinel.contents);
  await stop();
  await checkDatabaseRows();
  assert.match(fs.readFileSync(configFile, "utf8"), /# fixture: preserve this comment/);
  passed = true;
  console.log(`PASS isolated memory preferences: real CAS writes, tool-assisted inverse/legacy removal, fresh-process enable/disable, chronicle disable, v1/v2 artifact reset, preserved non-memory files; database rows ${databaseEvidence.verified ? "verified" : "UNVERIFIED"}; zero model turns`);
} catch (error) { failure = String(error?.stack || error); process.exitCode = 1; console.error(error); }
finally {
  await stop();
  const output = process.env.MEMORY_PREFERENCES_PROBE_OUTPUT || ".ref/parity/16.07/actual/16-07C/protocol/protocol-memory-preferences.json";
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ capturedAt: new Date().toISOString(), binary, version: version.stdout.trim(), isolatedHome: home, passed, failure, modelTurns: 0,
    sourceEvidence: { repository: "https://github.com/openai/codex", commit: "29eed280828d498fead76c3c5dedd9642836b571", files: ["codex-rs/protocol/src/memory_version.rs", "codex-rs/app-server/tests/suite/v2/memory_reset.rs", "codex-rs/state/src/runtime/memories.rs", "codex-rs/app-server/src/request_processors/thread_processor.rs"] },
    observations, databaseEvidence, calls, stderr, scope: "isolated CLI config persistence/artifact and database reset; not official UI, online generation or account memory" }, null, 2));
}
