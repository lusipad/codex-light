import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

let slots = [], cursor = 0, effects = [], pendingEffects = [], changed = false;
const listeners = new Map();
const react = {
  useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial;
    return [slots[index], value => { const next = typeof value === "function" ? value(slots[index]) : value; changed ||= !Object.is(next, slots[index]); slots[index] = next; }]; },
  useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
  useEffect(callback, deps) { const index = cursor++, previous = effects[index];
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) pendingEffects.push(() => {
      previous?.cleanup?.(); effects[index] = { deps, cleanup: callback() };
    }); },
};
const account = id => ({ account: { type: "chatgpt", email: `${id}@example.invalid`, planType: "pro" }, workspaceRouting: { chatgptAccountId: id } });
let read, rates, service;
let accountCalls = 0, serviceCalls = 0, rateCalls = 0;
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/accountUsage.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports, AbortController, require: name => {
  if (name === "react") return react;
  if (name === "./config") return { accountRead: () => { accountCalls++; return read(); }, accountRateLimitsRead: () => { rateCalls++; return rates(); } };
  if (name === "./bridge") return { tauriListen: async (name, listener) => {
    const set = listeners.get(name) || new Set(); listeners.set(name, set); set.add(listener); return () => set.delete(listener);
  } };
  if (name === "./chatgptService") return { serviceIdentity: async () => ({ accountId: "a", userId: "u", generation: 1 }),
    readChatgptService: (...args) => { serviceCalls++; assert.equal(args[0], "wham_usage"); assert.deepEqual(Object.keys(args[1]), []); return service(...args); }, serviceErrorMessage: () => "服务暂不可用" };
  throw Error(`Unexpected module ${name}`);
} });
const { normalizeServiceUsage, normalizeConnectionUsage, defaultUsageGroups, loadUsageSnapshot, useAccountUsage } = exports;
const rawWindow = (used, seconds = 18000) => ({ used_percent: used, limit_window_seconds: seconds, reset_at: 1800000000 });
const raw = used => ({ plan_type: "pro", rate_limit: { primary_window: rawWindow(used, 604800), secondary_window: rawWindow(0) },
  additional_rate_limits: [{ limit_name: " GPT_5.3 Codex Spark ", rate_limit: { primary_window: rawWindow(25) } },
    { limit_name: "other", rate_limit: { primary_window: rawWindow(35) } }, { limit_name: "other", rate_limit: { primary_window: rawWindow(45) } },
    { limit_name: " ", rate_limit: {} }], credits: { has_credits: true, unlimited: false, balance: "0.012345" } });
let data = normalizeServiceUsage(raw(80));
assert.equal(data.groups.length, 4); assert.equal(new Set(data.groups.map(group => group.key)).size, 4);
assert.equal(data.groups[0].windows[0].minutes, 300); assert.equal(data.groups[0].windows[0].remaining, 100);
assert.equal(data.groups[0].windows[1].remaining, 20); assert.equal(data.groups[0].windows[0].resetsAt, 1800000000);
assert.equal(defaultUsageGroups(data.groups).length, 2); assert.equal(data.credits.balance, "0.012345");
for (const unknown of [null, undefined, "0", NaN, Infinity, -1]) {
  assert.equal(normalizeServiceUsage({ rate_limit: { primary_window: rawWindow(unknown) } }).groups[0].windows[0].remaining, null);
}
assert.equal(normalizeServiceUsage({ rate_limit: { primary_window: rawWindow(150) } }).groups[0].windows[0].remaining, 0);
assert.equal(normalizeServiceUsage({ rate_limit: { primary_window: rawWindow(0, 0) } }).groups[0].windows.length, 0);
assert.equal(normalizeServiceUsage({ credits: { has_credits: true } }).credits.balance, null);
assert.throws(() => normalizeServiceUsage(null)); assert.throws(() => normalizeServiceUsage([]));
data = normalizeConnectionUsage({ rateLimits: { primary: { usedPercent: 99 } }, rateLimitsByLimitId: {
  first: { limitName: "first", primary: { usedPercent: 0, windowDurationMins: 300 } },
  second: { limitName: "second", primary: { windowDurationMins: 10080 }, secondary: { usedPercent: 100, windowDurationMins: 10080 } },
} });
assert.equal(data.groups.length, 2); assert.equal(data.groups[0].windows[0].minutes, 300);
assert.equal(data.groups[1].windows[0].remaining, null); assert.equal(data.groups[1].windows[1].remaining, 0);
console.log("PASS AC08-U01: all groups retained; default core/Spark; sorted independent windows; missing differs from known zero; credits and seconds retain units");

read = async () => ({ account: null }); rates = async () => ({}); service = async () => raw(80);
data = await loadUsageSnapshot(new AbortController().signal);
assert.equal(data.mode, "signed-out"); assert.equal(serviceCalls, 0); assert.equal(rateCalls, 0);
read = async () => account("a"); rates = async () => ({ accountId: "a", rateLimitsByLimitId: { a: { primary: { usedPercent: 0, windowDurationMins: 300 } }, b: { primary: { windowDurationMins: 300 } } } });
service = async () => null;
data = await loadUsageSnapshot(new AbortController().signal);
assert.equal(data.source, "connection"); assert.equal(data.groups.length, 2); assert.ok(data.warning);
service = async () => { throw Error("restricted"); }; rates = async () => { throw Error("unavailable"); };
data = await loadUsageSnapshot(new AbortController().signal);
assert.equal(data.source, null); assert.equal(data.groups.length, 0); assert.equal(data.credits, null);
let reads = 0; read = async () => account(++reads === 1 ? "a" : "b");
await assert.rejects(() => loadUsageSnapshot(new AbortController().signal), /账号发生变化/);
read = async () => account("a"); rates = async () => ({ accountId: "b" }); service = async () => null;
await assert.rejects(() => loadUsageSnapshot(new AbortController().signal), /所属账号/);
const aborted = new AbortController(); aborted.abort(); const previous = serviceCalls;
await assert.rejects(() => loadUsageSnapshot(aborted.signal), /取消/); assert.equal(serviceCalls, previous);
console.log("PASS AC08-U02: signed-out never fetches protected data; null/error fallback explicit; identity mismatch and cancellation reject without inventing history");

let view, identity = "account-a", connection = "server-1";
function render() { cursor = 0; pendingEffects = []; changed = false; view = useAccountUsage(identity, connection); pendingEffects.splice(0).forEach(effect => effect()); }
const settle = async () => { for (let i = 0; i < 30; i++) { await Promise.resolve(); if (changed) render(); } };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const emit = (name, event) => [...(listeners.get(name) || [])].forEach(listener => listener(event));
rates = async () => ({}); let old = deferred(), newer = deferred();
service = () => old.promise; render(); await settle(); assert.equal(view.loading, true);
service = () => newer.promise; emit("app-server:notification", { method: "account/rateLimits/updated" }); await settle();
newer.resolve(raw(90)); await settle(); assert.equal(view.data.groups[0].windows[1].remaining, 10);
old.resolve(raw(10)); await settle(); assert.equal(view.data.groups[0].windows[1].remaining, 10);
let late = deferred(); service = () => late.promise; void view.refresh(); await settle(); assert.equal(view.data, null);
service = async () => raw(40); identity = "account-b"; render(); assert.equal(view.data, null); await settle();
assert.equal(view.data.groups[0].windows[1].remaining, 60);
late.resolve(raw(1)); await settle(); assert.equal(view.data.groups[0].windows[1].remaining, 60);
emit("app-server:status", { connected: false }); await settle(); assert.equal(view.data, null); assert.match(view.error, /断开/);
emit("app-server:status", { connected: true }); await settle(); assert.equal(view.data.groups[0].windows[1].remaining, 60);
late = deferred(); service = () => late.promise; void view.refresh(); await settle(); effects.forEach(effect => effect?.cleanup?.());
assert.equal([...listeners.values()].reduce((sum, set) => sum + set.size, 0), 0);
const frozen = slots.slice(); late.resolve(raw(0)); await settle(); assert.deepEqual(slots, frozen);
console.log("PASS AC08-U03: production hook clears old data; notification invalidates pre-push GET; identity/restart/unmount reject late results and release subscriptions");

const source = fs.readFileSync("src/components/SettingsView.tsx", "utf8");
assert.ok(source.includes('<UsageSettings accountIdentity={accountIdentity} connectionIdentity={connectionIdentity} />'));
assert.ok(source.includes('slug: "usage"')); assert.ok(!source.includes("handleSaveVisual"), "dedicated settings must not expose generic configuration writes");
assert.ok(!source.includes("usageLast14Days")); assert.ok(!source.includes("accountRateSnapshot"));
const app = fs.readFileSync("src/App.tsx", "utf8");
assert.match(app, /onOpenUsage=\{\(\) => \{\s*setSettingsInitialSection\("usage"\)/);
console.log("PASS AC08-U04: separate account/usage routes; profile menu opens usage; old first-limit and synthetic 14-day chart removed");

let uiData = { mode: "chatgpt", source: "service", ...normalizeServiceUsage(raw(null)), warning: null };
const ui = {}, uiReact = { createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }) };
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/components/UsageSettings.tsx", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText, { exports: ui, require: name => name === "react" ? uiReact : name.endsWith(".css") ? {} : {
  defaultUsageGroups, useAccountUsage: () => ({ data: uiData, loading: false, error: null, refresh() {} }),
} });
function expand(node) {
  if (!node || typeof node !== "object") return node;
  if (typeof node.type === "function") return expand(node.type(node.props));
  return { ...node, children: node.children.map(expand) };
}
const nodes = node => !node || typeof node !== "object" ? [] : [node, ...node.children.flatMap(nodes)];
const textOf = node => typeof node === "string" || typeof node === "number" ? String(node) : node?.children?.map(textOf).join("") || "";
let tree = expand(ui.UsageSettings({ connectionIdentity: "server" }));
assert.equal(nodes(tree).filter(node => node.type === "progress").length, 2, "unknown core weekly must not draw 100% remaining");
assert.ok(textOf(tree).includes("暂不可用")); assert.ok(textOf(tree).includes("0.012345"));
assert.ok(!textOf(tree).includes("other")); assert.ok(textOf(tree).includes("剩余 100%"));
uiData = { mode: "signed-out", groups: [] }; tree = expand(ui.UsageSettings({ connectionIdentity: "server" }));
assert.equal(nodes(tree).filter(node => node.type === "progress").length, 0); assert.match(textOf(tree), /先登录/);
console.log("PASS AC08-U05: actual TSX renders known zero as 100% remaining, unknown without a bar, no fabricated credits/history or extra default groups");
