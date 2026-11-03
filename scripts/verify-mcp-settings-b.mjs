import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const clone = value => JSON.parse(JSON.stringify(value));
const name = String.raw`fixture.name"quoted\path`;
const mapKey = String.raw`header.key"quoted\name`;
const initial = { mcp_servers: {
  codex_app: { command: "reserved", enabled: false },
  sibling: { url: "https://example.invalid", enabled: false, unknown: { nested: [1, 2] } },
  [name]: { command: "fixture", args: ["a"], enabled: false, env: { [mapKey]: "before", KEEP: "unchanged" }, cwd: "fixture", tool_timeout_sec: 30, extra: { keep: true } },
} };
function fixture() {
  let local = clone(initial), effective = local, version = "v1", mode = "ok", readFailure = false, origins = {};
  const calls = [];
  const api = {
    configRead: async () => {
      if (readFailure) throw Error("read failed");
      return clone({ config: effective, origins, layers: [{ name: { type: "user", file: "old/config.toml" }, version: "old", config: {} }, { name: { type: "user", file: "fixture/config.toml" }, version, config: local }] });
    },
    configRequirementsRead: async () => ({ requirements: null }),
    configBatchWrite: async (edits, options) => {
      calls.push(clone({ edits, options }));
      if (mode === "reject") throw Error("Configuration was modified since last read. Fetch latest version and retry.");
      if (mode === "unknown") throw Error("connection interrupted");
      for (const edit of edits) {
        const keys = edit.keyPath.match(/"(?:\\.|[^"\\])*"/g).map(segment => JSON.parse(segment));
        let target = local;
        for (const key of keys.slice(0, -1)) target = target[key] ??= {};
        if (edit.value === null) delete target[keys.at(-1)];
        else target[keys.at(-1)] = clone(edit.value);
      }
      version = "v2";
      if (mode === "delivered") throw Error("response lost");
      if (mode === "read-failed") readFailure = true;
      return { status: "ok", filePath: "fixture/config.toml", version };
    },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/mcpSettings.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: () => api, Error });
  return { ...exports, calls, get local() { return local; }, mode: value => { mode = value; }, origins: value => { origins = value; }, override: value => { effective = value; } };
}
{
  const f = fixture(), before = await f.readMcpSettings("fixture/project");
  assert.equal(before.entries.length, 3, "reserved server is retained in client data");
  const result = await f.writeMcpServer(before, { type: "update", name, changes: { env: { [mapKey]: "after", KEEP: "unchanged", "A.B": "" } } });
  assert.equal(result.verification, "confirmed"); assert.equal(result.requiresRestart, true);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].edits.length, 2, "only changed map keys written");
  assert.equal(f.calls[0].options.expectedVersion, "v1"); assert.equal(f.calls[0].options.reloadUserConfig, false);
  assert.equal(f.calls[0].options.filePath, "fixture/config.toml", "last valid user layer selected");
  assert.equal(f.local.mcp_servers[name].env[mapKey], "after");
  assert.deepEqual(f.local.mcp_servers.codex_app, initial.mcp_servers.codex_app);
  assert.deepEqual(f.local.mcp_servers.sibling, initial.mcp_servers.sibling);
  assert.deepEqual(f.local.mcp_servers[name].extra, { keep: true });
  assert.equal(f.local.mcp_servers[name].tool_timeout_sec, 30);
  const duplicate = await f.writeMcpServer(result.snapshot, { type: "add", name, config: { command: "bad" } });
  assert.equal(duplicate.verification, "rejected"); assert.equal(f.calls.length, 1);
  const removed = await f.writeMcpServer(result.snapshot, { type: "update", name, changes: { env: { KEEP: "unchanged" } } });
  assert.equal(removed.verification, "confirmed"); assert.deepEqual(f.local.mcp_servers[name].env, { KEEP: "unchanged" });
  const deleted = await f.writeMcpServer(removed.snapshot, { type: "remove", name });
  assert.equal(deleted.verification, "confirmed"); assert.equal(f.local.mcp_servers[name], undefined);
}
for (const short of ["alpha", name]) {
  const f = fixture(), longer = `${short}.beta`;
  f.local.mcp_servers[short] ??= { command: "fixture-user", enabled: false };
  const effective = clone(f.local);
  effective.mcp_servers[longer] = { command: "fixture-project", enabled: false };
  f.override(effective);
  f.origins({
    [`mcp_servers.${short}.command`]: { name: { type: "user" }, version: "v1" },
    [`mcp_servers.${longer}.command`]: { name: { type: "project" }, version: "project" },
  });
  const snapshot = await f.readMcpSettings();
  const user = snapshot.entries.find(entry => entry.name === short);
  assert.equal(user.source, "user", "literal dotted sibling origin must not contaminate prefix server");
  assert.equal(user.readOnlyReason, null);
  assert.equal(snapshot.entries.find(entry => entry.name === longer).source, "project");
  assert.equal((await f.writeMcpServer(snapshot, { type: "toggle", name: longer, enabled: true })).verification, "rejected");
  assert.equal(f.calls.length, 0);
  f.origins({
    [`mcp_servers.${short}.command`]: { name: { type: "user" }, version: "v1" },
    [`mcp_servers.${short}.env.PROJECT`]: { name: { type: "project" }, version: "project" },
    [`mcp_servers.${longer}.command`]: { name: { type: "project" }, version: "project" },
  });
  assert.equal((await f.readMcpSettings()).entries.find(entry => entry.name === short).source, "project", "same server mixed origins stay read-only");
}
for (const key of ["mcp_servers", `mcp_servers.${name}.command`]) {
  const f = fixture(); f.origins({ [key]: { name: { type: "project" }, version: "project" } });
  const snapshot = await f.readMcpSettings();
  assert.equal(snapshot.entries.find(entry => entry.name === name).source, "project");
  assert.equal((await f.writeMcpServer(snapshot, { type: "remove", name })).verification, "rejected");
  assert.equal(f.calls.length, 0);
}
for (const [mode, verification, restart] of [["reject", "rejected", false], ["unknown", "pending", false], ["delivered", "confirmed", true], ["read-failed", "pending", true]]) {
  const f = fixture(), before = await f.readMcpSettings(); f.mode(mode);
  const result = await f.writeMcpServer(before, { type: "toggle", name, enabled: true });
  assert.equal(result.verification, verification, mode); assert.equal(result.requiresRestart, restart, mode);
  assert.equal(f.calls.length, 1, "unknown delivery must not replay write");
}
{
  const f = fixture(), before = await f.readMcpSettings();
  f.override(clone(initial));
  const result = await f.writeMcpServer(before, { type: "toggle", name, enabled: true });
  assert.equal(result.verification, "pending"); assert.equal(result.requiresRestart, true);
  assert.match(result.error, /覆盖/);
  const project = clone(before); project.entries.find(entry => entry.name === name).readOnlyReason = "项目来源";
  assert.equal((await f.writeMcpServer(project, { type: "remove", name })).verification, "rejected");
  assert.equal(f.calls.length, 1);
}
console.log("PASS MCP production client: exact quoted paths, map-key diff, reserved/unknown/sibling preservation, duplicate/source guards, CAS, readback and unknown delivery without replay or reload");
