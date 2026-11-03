// Read-only discovery in an isolated CODEX_HOME; never authenticates or creates a turn.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-model-catalog-"));
const binary = process.env.CODEX_CLI_PATH || (process.platform === "win32" ? "codex.cmd" : "codex");
const options = {
  shell: binary.endsWith(".cmd"), windowsHide: true,
  env: { ...process.env, CODEX_HOME: home, OPENAI_API_KEY: "", CODEX_API_KEY: "" },
};
const version = spawnSync(binary, ["--version"], { ...options, encoding: "utf8" });
assert.equal(version.status, 0, version.stderr);
const child = spawn(binary, ["app-server", "--listen", "stdio://"], { ...options, stdio: ["pipe", "pipe", "pipe"] });
const pending = new Map(), calls = [];
let nextId = 0, buffer = "", errorOutput = "", failure = null, pageCount = 0, modelCount = 0;
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
  assert.ok(["initialize", "model/list"].includes(method), "probe is restricted to read-only discovery");
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
    clientInfo: { name: "codex-native-model-catalog-probe", version: "0.1.0" },
    capabilities: { experimentalApi: true },
  });
  let cursor = null;
  const seen = new Set();
  do {
    const page = await rpc("model/list", { cursor, includeHidden: true, limit: 1 });
    assert.ok(Array.isArray(page.data));
    for (const model of page.data) {
      assert.equal(typeof model.id, "string");
      assert.equal(typeof model.model, "string");
      assert.equal(typeof model.hidden, "boolean");
      assert.ok(Array.isArray(model.supportedReasoningEfforts));
    }
    modelCount += page.data.length; pageCount++;
    cursor = page.nextCursor ?? null;
    if (cursor != null) {
      assert.equal(typeof cursor, "string"); assert.ok(!seen.has(cursor)); seen.add(cursor);
    }
  } while (cursor != null);
  console.log(`PASS real model/list: ${pageCount} pages, ${modelCount} advertised entries; zero model turns`);
} catch (error) {
  failure = String(error); process.exitCode = 1; console.error(error);
} finally {
  if (child.exitCode == null) await new Promise(resolve => {
    const timer = setTimeout(() => { child.kill(); resolve(); }, 3000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    child.stdin.end();
  });
  const directory = ".ref/parity/16.05/runs/20261101-codex-model-catalog/actual";
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "protocol-model-catalog.json"), JSON.stringify({
    version: version.stdout.trim(), isolatedHome: home, pageCount, modelCount, calls, failure, errorOutput, modelTurns: 0,
  }, null, 2));
}
