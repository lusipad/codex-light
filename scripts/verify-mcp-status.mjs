import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

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

const source = fs.readFileSync("src/components/SettingsView.tsx", "utf8");
const ast = ts.createSourceFile("SettingsView.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler, effect;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "handleTestMcpServer") handler = node.initializer;
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" &&
    node.arguments[0]?.getText(ast).includes("mcpStatusGeneration.current += 1")) effect = node.arguments[0];
  ts.forEachChild(node, visit);
}
visit(ast); assert.ok(handler); assert.ok(effect);
let values = {}, release;
const context = {
  mcpTestRequests: { current: new Set() }, mcpStatusGeneration: { current: 0 },
  setMcpTestStatus: value => { values = typeof value === "function" ? value(values) : value; },
  readMcpServerStatus: () => request(), describeMcpStatus, toErrorMessage: String,
};
const click = vm.runInNewContext(transpile(`(${handler.getText(ast)})`), context);
const cleanup = vm.runInNewContext(transpile(`(${effect.getText(ast)})()`), context);
let count = 0;
request = () => { count++; return new Promise(resolve => { release = resolve; }); };
const first = click({ id: "fixture" }); await click({ id: "fixture" }); assert.equal(count, 1);
release({ ...status, runtimeStatus: "connected" }); await first; assert.match(values.fixture, /^已连接/);
request = async () => { throw Error("offline"); }; await click({ id: "fixture" }); assert.match(values.fixture, /状态读取失败.*offline/);
request = () => new Promise(resolve => { release = resolve; });
const late = click({ id: "fixture" }); cleanup(); const previous = values;
release({ ...status, runtimeStatus: "connected" }); await late;
assert.equal(values, previous); assert.equal(context.mcpTestRequests.current.size, 0);
assert.ok(!handler.getText(ast).includes("fetch(") && !handler.getText(ast).includes("exec_shell_command"));
console.log("PASS MCN03/MCN04: actual callback single-flight, visible errors, leave/unmount stale protection and no HEAD/shell test");
