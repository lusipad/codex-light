// Real isolated protocol evidence. No model turns, real accounts, or product-backend claims.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-archive-deletion-"));
const isolatedHome = path.join(directory, "home");
const workspace = path.join(directory, "workspace");
for (const location of [isolatedHome, workspace]) fs.mkdirSync(location);
const binary = process.env.CODEX_CLI_PATH || (process.platform === "win32" ? "codex.cmd" : "codex");
const output = process.env.ARCHIVE_DELETION_PROBE_OUTPUT || ".ref/protocol-probe/archive-deletion.json";
const options = {
  shell: binary.endsWith(".cmd"), windowsHide: true,
  env: { ...process.env, CODEX_HOME: isolatedHome, OPENAI_API_KEY: "", CODEX_API_KEY: "" },
};
let child, buffer = "", nextId = 0, stderr = "", passed = false, failure = null;
const pending = new Map(), transcript = [], notifications = [], checks = [], schemas = [];
const fixtureIds = new Set();
const sha256 = data => crypto.createHash("sha256").update(data).digest("hex");
const version = spawnSync(binary, ["--version"], { ...options, encoding: "utf8", timeout: 15000 });

function rpc(method, params) {
  assert.notEqual(method, "turn/start", "this probe cannot generate model turns");
  if (method === "thread/delete") {
    assert.ok(fixtureIds.has(params.threadId), "only this probe's created fixture may be deleted");
    assert.deepEqual(Object.keys(params), ["threadId"], "do not invent recovery extension fields");
  }
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} timed out`)); }, 15000);
    pending.set(id, {
      resolve(response) {
        clearTimeout(timer); pending.delete(id);
        transcript.push({ method, params, response }); resolve(response);
      },
      reject(error) { clearTimeout(timer); pending.delete(id); reject(error); },
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
async function request(method, params) {
  const response = await rpc(method, params);
  assert.equal(response.error, undefined, `${method}: ${JSON.stringify(response.error)}`);
  return response.result;
}
function check(name) { checks.push(name); console.log(`PASS ${name}`); }
async function archivedList(limit = 200) {
  let cursor = null, pageCount = 0;
  const rows = [], cursors = new Set();
  do {
    const page = await request("thread/list", { archived: true, useStateDbOnly: true, cursor, limit });
    assert.ok(Array.isArray(page.data));
    rows.push(...page.data); pageCount++;
    cursor = page.nextCursor;
    assert.ok(cursor == null || typeof cursor === "string");
    if (cursor != null) {
      assert.ok(!cursors.has(cursor), "archived cursor must advance");
      cursors.add(cursor);
    }
  } while (cursor != null);
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length, "no duplicate archived IDs");
  for (const row of rows) assert.ok(fixtureIds.has(row.id), "isolated home contains only fixture IDs");
  return { rows, pageCount };
}
async function createFixture(index, archive = true) {
  const { thread } = await request("thread/start", { cwd: workspace, approvalPolicy: "on-request", sandbox: "read-only" });
  fixtureIds.add(thread.id);
  await request("thread/inject_items", {
    threadId: thread.id,
    items: [{ type: "message", role: "user", content: [{ type: "input_text", text: `Offline deletion fixture ${index}.` }] }],
  });
  if (archive) await request("thread/archive", { threadId: thread.id });
  return thread.id;
}
async function stop() {
  if (!child || child.exitCode != null) return;
  await new Promise(resolve => {
    const timer = setTimeout(() => {
      if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
      else child.kill("SIGKILL");
      resolve();
    }, 5000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    child.stdin.end();
  });
}

try {
  assert.equal(version.status, 0, version.stderr);
  const git = spawnSync("git", ["init", workspace], { windowsHide: true, encoding: "utf8", timeout: 15000 });
  assert.equal(git.status, 0, git.stderr);
  const schemaDirectory = path.join(directory, "schema");
  const generated = spawnSync(binary, ["app-server", "generate-json-schema", "--experimental", "--out", schemaDirectory], {
    ...options, encoding: "utf8", timeout: 30000,
  });
  assert.equal(generated.status, 0, generated.stderr);
  for (const name of ["ThreadListParams", "ThreadDeleteParams"]) {
    const source = path.join(schemaDirectory, "v2", `${name}.json`);
    const raw = fs.readFileSync(source);
    const schema = JSON.parse(raw);
    schemas.push({ name, sha256: sha256(raw), bytes: raw.length, schema });
    if (name === "ThreadListParams") {
      for (const field of ["archived", "useStateDbOnly", "cursor", "limit"]) assert.ok(schema.properties[field], field);
    } else {
      assert.deepEqual(schema.required, ["threadId"]);
      assert.equal(schema.properties.missingRolloutRecovery, undefined);
    }
  }
  check("generated schemas declare archived database-only pagination and threadId-only deletion; recovery extension is not declared");
  child = spawn(binary, ["app-server", "--listen", "stdio://"], { ...options, stdio: ["pipe", "pipe", "pipe"] });
  child.stderr.on("data", data => { stderr = (stderr + data).slice(-16000); });
  child.on("error", error => { for (const value of [...pending.values()]) value.reject(error); });
  child.on("exit", code => { for (const value of [...pending.values()]) value.reject(Error(`app-server exited: ${code}`)); });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", data => {
    buffer += data;
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line);
        if (message.id != null) pending.get(message.id)?.resolve(message);
        else if (message.method) notifications.push(message);
      } catch (error) { for (const value of [...pending.values()]) value.reject(error); }
    }
  });
  await request("initialize", { clientInfo: { name: "codex-native-archive-deletion-probe", version: "0.1.0" }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} }) + "\n");
  const first = await createFixture(1);
  const restored = await createFixture(2);
  const active = await createFixture(3, false);
  const paginated = await archivedList(1);
  assert.deepEqual(new Set(paginated.rows.map(row => row.id)), new Set([first, restored]));
  assert.ok(paginated.pageCount >= 2);
  check("real database-only archived pagination includes exactly archived fixture rollouts");
  await request("thread/unarchive", { threadId: restored });
  const rechecked = await archivedList();
  assert.deepEqual(rechecked.rows.map(row => row.id), [first]);
  const deletesBefore = transcript.filter(row => row.method === "thread/delete").length;
  // Mirror only the protocol sequence: Rust tests separately exercise the product service.
  if (rechecked.rows.some(row => row.id === restored)) await request("thread/delete", { threadId: restored });
  assert.equal(transcript.filter(row => row.method === "thread/delete").length, deletesBefore);
  assert.equal((await request("thread/read", { threadId: restored, includeTurns: false })).thread.id, restored);
  check("restored stale archive target is absent on real re-enumeration and receives no delete request");
  const addedAfterSnapshot = await createFixture(4);
  const executionSet = (await archivedList()).rows.map(row => row.id);
  assert.deepEqual(new Set(executionSet), new Set([first, addedAfterSnapshot]));
  for (const threadId of executionSet) await request("thread/delete", { threadId });
  assert.deepEqual((await archivedList()).rows, []);
  for (const threadId of executionSet) {
    const response = await rpc("thread/read", { threadId, includeTurns: false });
    assert.ok(response.error, "actually deleted rollout cannot be read");
  }
  for (const threadId of [restored, active]) {
    assert.equal((await request("thread/read", { threadId, includeTurns: false })).thread.id, threadId);
  }
  check("execution-time complete archive set is permanently deleted; restored and never-archived rollouts remain readable");
  const repeated = await rpc("thread/delete", { threadId: first });
  assert.ok(repeated.error, "repeated actual delete reports failure instead of invented success");
  check("real missing-rollout delete reports an error; no unverified recovery extension is sent");
  assert.ok(!notifications.some(event => event.method === "turn/started"));
  assert.ok(!transcript.some(row => row.method === "turn/start"));
  check("zero model turns and every delete target belongs to the isolated fixture set");
  passed = true;
} catch (error) {
  failure = String(error?.stack || error);
  process.exitCode = 1;
  console.error(failure);
} finally {
  await stop();
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({
    capturedAt: new Date().toISOString(), binary, version: version.stdout?.trim(), isolatedHome, workspace,
    passed, failure, checks, schemas, fixtureIds: [...fixtureIds], transcript, notifications, stderr,
    scope: "real isolated CLI protocol lifecycle; not product AppManager invocation, official UI, focus, or pixel parity",
  }, null, 2));
  console.log(`Evidence: ${output}`);
}
