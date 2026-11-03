import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const transpile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
let read, rates, usage;
const mod = { exports: {} }, calls = [];
vm.runInNewContext(transpile(fs.readFileSync("src/accountSnapshot.ts", "utf8")), {
  exports: mod.exports, require: () => ({
    accountRead: () => { calls.push("account"); return read(); },
    accountRateLimitsRead: () => { calls.push("rates"); return rates(); },
    accountUsageRead: () => { calls.push("usage"); return usage(); },
  }),
});
const { loadAccountSnapshot } = mod.exports;
const loggedOut = { account: null, requiresOpenaiAuth: true };
const account = id => ({ account: { type: "chatgpt", email: `${id}@example.invalid`, planType: "pro" }, workspaceRouting: { chatgptAccountId: id } });
read = async () => loggedOut;
let result = await loadAccountSnapshot();
assert.equal(result.info, loggedOut); assert.equal(result.rateLimits, null); assert.equal(result.usage, null);
assert.deepEqual(calls, ["account"]);
console.log("PASS AC01: logged out snapshot never reads protected usage or invents zero metrics");

let reads = 0;
read = async () => account(++reads === 1 ? "first" : "second");
rates = async () => ({ accountId: "first", rateLimits: { primary: { usedPercent: 20 } } });
usage = async () => ({ summary: { lifetimeTokens: 90 } });
await assert.rejects(loadAccountSnapshot, /账号发生变化/);
read = async () => account("first");
rates = async () => ({ accountId: "second", rateLimits: {} });
result = await loadAccountSnapshot();
assert.equal(result.rateLimits, null); assert.equal(result.usage.summary.lifetimeTokens, 90);
assert.match(result.error, /所属账号/);
rates = async () => { throw Error("rate unavailable"); };
result = await loadAccountSnapshot();
assert.equal(result.rateLimits, null); assert.equal(result.usage.summary.lifetimeTokens, 90);
assert.match(result.error, /rate unavailable/);
rates = async () => ({ accountId: "first", rateLimits: {} });
usage = async () => { throw Error("usage unavailable"); };
result = await loadAccountSnapshot();
assert.ok(result.rateLimits); assert.equal(result.usage, null); assert.match(result.error, /usage unavailable/);
console.log("PASS AC02/AC03: identity fence, rate account mismatch, independent partial failures and missing data remain unavailable");

const source = fs.readFileSync("src/components/SettingsView.tsx", "utf8");
const ast = ts.createSourceFile("SettingsView.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let loadNode, effectNode;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "loadAccountData") loadNode = node.initializer;
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" &&
    node.arguments[0]?.getText(ast).includes('tauriListen<any>("app-server:notification"')) effectNode = node.arguments[0];
  ts.forEachChild(node, visit);
}
visit(ast); assert.ok(loadNode); assert.ok(effectNode);
const state = { loading: false, info: account("old"), rates: {}, usage: {}, error: null };
let load;
let listener, stopLate, stopped = 0;
const context = {
  accountRequest: { current: 0 }, activeSection: "account",
  loadAccountSnapshot: () => load(),
  setAccountLoading: value => { state.loading = value; },
  setAccountInfo: value => { state.info = value; },
  setAccountRateLimits: value => { state.rates = value; },
  setAccountUsage: value => { state.usage = value; },
  setAccountError: value => { state.error = value; },
  toErrorMessage: String,
  tauriListen: (_name, callback) => { listener = callback; return new Promise(resolve => { stopLate = resolve; }); },
};
const actualLoad = vm.runInNewContext(transpile(`(${loadNode.getText(ast)})`), context);
context.loadAccountData = actualLoad;
let resolveOld, resolveNew;
load = () => new Promise(resolve => { resolveOld = resolve; });
const old = actualLoad();
assert.equal(state.info, null); assert.equal(state.rates, null); assert.equal(state.usage, null);
load = () => new Promise(resolve => { resolveNew = resolve; });
const newer = actualLoad();
resolveNew({ info: account("new"), rateLimits: { accountId: "new" }, usage: null, error: "partial" }); await newer;
resolveOld({ info: account("old"), rateLimits: {}, usage: {}, error: null }); await old;
assert.equal(state.info.workspaceRouting.chatgptAccountId, "new"); assert.equal(state.error, "partial");
const cleanup = vm.runInNewContext(transpile(`(${effectNode.getText(ast)})()`), context);
load = () => new Promise(resolve => { resolveNew = resolve; });
listener({ method: "account/updated" });
assert.equal(state.info, null); assert.equal(state.rates, null);
cleanup();
stopLate(() => { stopped++; }); await Promise.resolve(); await Promise.resolve();
assert.equal(stopped, 1);
resolveNew({ info: account("late"), rateLimits: {}, usage: {}, error: null }); await Promise.resolve(); await Promise.resolve();
assert.equal(state.info, null);
const version = context.accountRequest.current;
listener({ method: "account/updated" });
assert.equal(context.accountRequest.current, version);
assert.ok(source.includes('activeSection !== "account" &&'));
console.log("PASS AC04: production refresh clears stale data, rejects old/left-page responses, account event reloads and late subscription releases");
