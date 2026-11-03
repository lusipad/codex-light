import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createMcpSettingsHarness, mcpFixture, mcpEntry } from "./verify-mcp-settings-ui-b.mjs";

const transpile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
let request;
const calls = [], mod = { exports: {} };
vm.runInNewContext(transpile(fs.readFileSync("src/mcpStatus.ts", "utf8")), {
  exports: mod.exports, require: () => ({ callAppServer: (...args) => { calls.push(args); return request(...args); } }),
});
const { readMcpServerStatus, describeMcpStatus } = mod.exports;
const status = { name: "fixture", authStatus: "unsupported", tools: { tool: {} } };
request = async (_method, params) => params.cursor === null ? { data: [], nextCursor: "opaque" } : { data: [status], nextCursor: null };
assert.equal(await readMcpServerStatus("fixture"), status);
assert.equal(calls.length, 2);
for (const [method, params] of calls) {
  assert.equal(method, "mcpServerStatus/list"); assert.equal(params.serverName, "fixture"); assert.equal(params.detail, "full");
}
request = async () => ({ data: [], nextCursor: "repeat" });
await assert.rejects(() => readMcpServerStatus("fixture"), /分页无效/);
request = async () => ({ data: null });
await assert.rejects(() => readMcpServerStatus("fixture"), /格式无效/);
request = async () => ({ data: [] }); assert.equal(await readMcpServerStatus("fixture"), null);
assert.match(describeMcpStatus(status), /连接状态未知/);
assert.match(describeMcpStatus({ ...status, runtimeStatus: "connected" }), /^已连接/);
for (const runtimeStatus of ["starting", "failed", "disabled", "authenticationRequired", "cancelled", "notStarted"]) {
  assert.ok(!describeMcpStatus({ ...status, runtimeStatus }).startsWith("已连接"));
}
assert.match(describeMcpStatus({ ...status, runtimeStatus: "connected", toolsError: "denied" }), /工具发现失败/);
assert.match(describeMcpStatus({ ...status, authStatus: "notLoggedIn" }), /未登录/);
console.log("PASS MCN01/MCN02: real status RPC pagination, invalid/empty responses and no false connected status from discovery/auth/tool failure");

const view = createMcpSettingsHarness({ snapshot: mcpFixture([mcpEntry("fixture")]) });
view.render(); await view.tick();
let count = 0, release;
view.setProtocol(() => { count++; return new Promise(resolve => { release = resolve; }); });
const first = view.state.checkStatus("fixture"); await view.state.checkStatus("fixture"); assert.equal(count, 1);
release({ data: [{ ...status, runtimeStatus: "connected" }], nextCursor: null }); await first; view.render();
assert.match(view.state.statusMessages.fixture, /^已连接/);
view.setProtocol(async () => { throw Error("offline"); }); await view.state.checkStatus("fixture"); view.render();
assert.match(view.state.statusMessages.fixture, /状态读取失败.*offline/);
view.setProtocol(() => new Promise(resolve => { release = resolve; }));
const late = view.state.checkStatus("fixture"); view.render(); view.unmount(); const previousUpdates = view.updateCount;
release({ data: [{ ...status, runtimeStatus: "connected" }], nextCursor: null }); await late;
assert.equal(view.updateCount, previousUpdates); assert.equal(view.listenerCount, 0);
const productionState = fs.readFileSync("src/mcpSettingsState.ts", "utf8");
assert.ok(!productionState.includes("fetch(") && !productionState.includes("exec_shell_command"));
console.log("PASS MCN03/MCN04: actual callback single-flight, visible errors, leave/unmount stale protection and no HEAD/shell test");
