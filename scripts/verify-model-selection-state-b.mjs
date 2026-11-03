import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(file, imports) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: module.exports, require: name => imports[name] || {}, console });
  return module.exports;
}
const caps = load("src/modelCapabilities.ts", {});
const callbacks = [], states = [], effects = [];
let cursor = 0;
const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
const react = {
  useState(initial) {
    const index = cursor++;
    if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
    return [states[index], update => { states[index] = typeof update === "function" ? update(states[index]) : update; }];
  },
  useRef(value) { const index = cursor++; return states[index] ||= { current: value }; },
  useCallback(fn, dependencies) {
    const index = cursor++;
    if (!same(states[index]?.dependencies, dependencies)) states[index] = { fn, dependencies };
    return states[index].fn;
  },
  useEffect(fn, dependencies) {
    const index = cursor++;
    if (!same(states[index]?.dependencies, dependencies)) {
      effects.push(() => { states[index]?.cleanup?.(); states[index] = { dependencies, cleanup: fn() }; });
    }
  },
};
const models = [{ id: "ui-a", model: "wire-a", isDefault: true, defaultReasoningEffort: "medium", supportedReasoningEfforts: ["medium", "high"], serviceTiers: [{ id: "vendor-fast", name: "Fast" }] },
  { id: "ui-b", model: "wire-b", defaultReasoningEffort: "low", supportedReasoningEfforts: ["low", "high"], serviceTiers: [] }];
const preference = { config: {}, requirements: { requirements: null }, revision: "v1", profile: null,
  defaults: { model: "wire-a", reasoningEffort: "high", serviceTier: null }, recents: [] };
const calls = [];
let read = async () => preference;
let write = async args => ({ ...preference, revision: "v2", defaults: args.configuration });
let update = async () => ({});
const bridge = {
  async tauriInvoke(command, args) {
    calls.push({ command, args });
    if (command === "model_preferences_read") return read(args);
    if (command === "model_preferences_write_default") return write(args);
    if (command === "model_recent_record") return { recents: [args.configuration] };
    throw Error(command);
  },
  async callAppServer(method, args) { calls.push({ method, args }); return update(args); },
  async tauriListen(_name, callback) { callbacks.push(callback); return () => {}; },
};
const api = load("src/modelSelection.ts", { react, "./bridge": bridge, "./modelCapabilities": caps });
let options = { models, connected: true, cwd: "C:/test", authMethod: "chatgpt" };
function render() { cursor = 0; const result = api.useModelSelection(options); while (effects.length) effects.shift()(); return result; }
const tick = () => new Promise(resolve => setImmediate(resolve));
let state = render();
assert.throws(() => state.getConfiguration(), /读取|保存/);
await tick(); state = render();
assert.equal(state.getConfiguration().model, "wire-a");
assert.equal(state.getConfiguration().reasoningEffort, "high");
assert.equal(state.serviceTierAccess.fast, true);
assert.equal(api.getServiceTierAccess({ ...preference, requirements: null }, "chatgpt"), null);
assert.equal(api.getServiceTierAccess(preference, "apikey"), null);
assert.equal(api.getServiceTierAccess({ ...preference, requirements: { requirements: { featureRequirements: { fast_mode: false, ultrafast_mode: true } }, supportsIndependentSpeedModes: true } }, "chatgpt").ultrafast, true);
await state.selectModel("ui-b"); state = render();
assert.equal(state.getConfiguration().model, "wire-b");
assert.equal(state.getConfiguration().reasoningEffort, "high");
assert.equal(calls.at(-1).command, "model_preferences_write_default");
assert.equal(calls.at(-1).args.configuration.model, "wire-b");
const count = calls.length;
await state.selectConfiguration({ model: "ui-a", reasoningEffort: "high", serviceTier: null }, false, false);
state = render();
assert.equal(calls.length, count);
await state.selectModel("", true); state = render();
assert.equal(calls.at(-1).args.configuration.model, null);
assert.equal(state.defaultModelSelected, true);
console.log("PASS MC-B03/04/06: real eligibility response versus missing, effort retention, default clearing and draft-only selection");

options = { ...options, threadId: "one" };
state = render();
assert.throws(() => state.getConfiguration(), /读取|保存/);
state.hydrateThread("one", { thread: { model: "wire-a", reasoningEffort: "high" } }); state = render();
assert.throws(() => state.getConfiguration(), /速度配置/);
state.hydrateThread("one", { model: "wire-a", reasoningEffort: "high", serviceTier: null }); state = render();
const stableHydrate = state.hydrateThread, stableGet = state.getConfiguration;
let finish;
update = () => new Promise(resolve => { finish = resolve; });
const firstWrite = state.selectTier("vendor-fast");
await state.selectTier(null);
assert.equal(calls.at(-1).method, "thread/settings/update");
assert.equal(calls.at(-1).args.serviceTier, "vendor-fast");
const writeCount = calls.filter(call => call.method).length;
assert.equal(writeCount, 1);
options = { ...options, threadId: "two" }; state = render();
state.hydrateThread("two", { model: "wire-b", reasoningEffort: "low", serviceTier: null }); state = render();
finish({}); await firstWrite; state = render();
assert.equal(state.getConfiguration().model, "wire-b");
assert.equal(state.serviceTier, null);
assert.equal(state.hydrateThread, stableHydrate);
assert.equal(state.getConfiguration, stableGet);
options = { ...options, threadId: "one" }; state = render();
assert.equal(state.getConfiguration().serviceTier, "vendor-fast");
update = async () => { throw Error("denied"); };
await state.selectEffort("medium"); state = render();
assert.match(state.selectionError, /denied/);
assert.equal(state.reasoningEffort, "high");
console.log("PASS MC-B05/08: thread-only settings payload, synchronous double-click guard, cross-thread late response, missing tier lock and failed-write rollback");

const beforeWriteToken = state.beginThreadHydration("one");
const finishes = new Map();
update = args => new Promise(resolve => { finishes.set(args.threadId, resolve); });
const writingA = state.selectEffort("medium");
assert.throws(() => state.getConfiguration(), /保存/, "same tick after selecting must not send old settings");
options = { ...options, threadId: "two" }; state = render();
const writingB = state.selectEffort("high");
finishes.get("two")({}); await writingB;
options = { ...options, threadId: "one" }; state = render();
assert.equal(state.selectionPending, true, "finishing B must not clear A's pending write");
assert.throws(() => state.getConfiguration(), /保存/);
finishes.get("one")({}); await writingA; state = render();
assert.equal(state.selectionPending, false);
assert.equal(state.getConfiguration().reasoningEffort, "medium");
state.hydrateThread("one", { model: "wire-a", reasoningEffort: "high", serviceTier: null }, beforeWriteToken);
state = render();
assert.equal(state.getConfiguration().reasoningEffort, "medium", "resume begun before a mutation must not overwrite its confirmed result");
const supersededRead = state.beginThreadHydration("one");
const currentRead = state.beginThreadHydration("one");
state.hydrateThread("one", { model: "wire-a", reasoningEffort: "high", serviceTier: null }, currentRead);
state = render();
state.hydrateThread("one", { model: "wire-b", reasoningEffort: "low", serviceTier: null }, supersededRead);
state = render();
assert.equal(state.getConfiguration().model, "wire-a");
assert.equal(state.getConfiguration().reasoningEffort, "high");
console.log("PASS MC-B05 concurrency: A/B overlapping writes remain independently pending, same-tick send blocked, pre-write and superseded hydration responses rejected");

const beforeServerToken = state.beginThreadHydration("one");
const normalizingWrite = state.selectTier("vendor-fast");
state.applyThreadSettings("one", { model: "wire-a", effort: "medium", serviceTier: null });
state = render();
assert.equal(state.selectionPending, true);
finishes.get("one")({}); await normalizingWrite; state = render();
assert.equal(state.getConfiguration().serviceTier, null, "ACK cannot overwrite the server's normalized speed");
assert.equal(state.getConfiguration().reasoningEffort, "medium");
state.hydrateThread("one", { model: "wire-a", reasoningEffort: "high", serviceTier: "vendor-fast" }, beforeServerToken);
state = render();
assert.equal(state.getConfiguration().serviceTier, null, "server notification invalidates a previous hydration token");
state.applyThreadSettings("two", { model: "wire-a", effort: "high", serviceTier: "default" }); state = render();
assert.equal(state.getConfiguration().reasoningEffort, "medium", "other window's inactive thread update cannot contaminate the active scope");
options = { ...options, threadId: "two" }; state = render();
assert.equal(state.getConfiguration().model, "wire-a");
assert.equal(state.getConfiguration().reasoningEffort, "high");
assert.equal(state.getConfiguration().serviceTier, null);
console.log("PASS MC-B05 authoritative settings: normalized event before ACK wins, old hydration rejected, cross-window scopes stay isolated and default tier becomes null");

let resolveOld;
read = () => new Promise(resolve => { resolveOld = resolve; });
options = { ...options, cwd: "C:/old", threadId: null }; state = render();
await tick();
const oldFinish = resolveOld;
read = async () => ({ ...preference, defaults: { model: "wire-b", reasoningEffort: "low", serviceTier: null } });
options = { ...options, cwd: "C:/new" }; state = render(); await tick(); state = render();
oldFinish(preference); await tick(); state = render();
assert.equal(state.getConfiguration().model, "wire-b");
options = { ...options, models: [] }; state = render();
assert.throws(() => state.getConfiguration(), /目录|不可用/);
options = { ...options, connected: false }; state = render();
assert.throws(() => state.getConfiguration(), /连接/);
console.log("PASS MC-B01/08: old cwd preference response ignored, empty catalog and disconnected submission rejected");

const tierModels = [{ ...models[0], defaultServiceTier: "vendor-fast" }];
read = async () => ({ ...preference, defaults: { model: null, reasoningEffort: null, serviceTier: null } });
options = { ...options, connected: true, cwd: "C:/default-tier", models: tierModels, authMethod: "chatgpt" };
state = render(); await tick(); state = render();
assert.equal(state.getConfiguration().serviceTier, "vendor-fast", "missing config must honor the actual model default tier");
await state.selectConfiguration({ model: "wire-a", reasoningEffort: "high", serviceTier: null }, false, false);
state = render();
assert.equal(state.getConfiguration().serviceTier, null, "explicit standard must stay distinct from missing config");
options = { ...options, cwd: "C:/default-tier-denied", authMethod: "apikey" };
state = render(); await tick(); state = render();
assert.throws(() => state.getConfiguration(), /资格/, "denied default speed must lock rather than downgrade to standard");
read = async () => ({ ...preference, config: { service_tier: "default" }, defaults: { model: null, reasoningEffort: null, serviceTier: null } });
options = { ...options, cwd: "C:/explicit-standard" };
state = render(); await tick(); state = render();
assert.equal(state.getConfiguration().serviceTier, null);
console.log("PASS MC-B04 default tier: missing config resolves real default id, explicit standard remains null, denied default is blocked");

read = async () => preference;
options = { ...options, models, authMethod: "chatgpt", accountIdentity: "account-a", cwd: "C:/account" };
state = render(); await tick(); state = render();
assert.equal(state.serviceTierAccess.fast, true);
let finishAccountRead;
read = () => new Promise(resolve => { finishAccountRead = resolve; });
const oldAccountRead = state.refreshPreferences();
const deniedPreference = { ...preference, requirements: { requirements: { featureRequirements: { fast_mode: false, ultrafast_mode: false } } } };
read = async () => deniedPreference;
options = { ...options, accountIdentity: "account-b" };
state = render();
assert.equal(state.serviceTierAccess, null, "same auth method with a different identity cannot reuse previous access");
assert.throws(() => state.getConfiguration(), /读取|保存/);
await tick(); state = render();
assert.equal(state.serviceTierAccess.fast, false);
finishAccountRead(preference); await oldAccountRead; state = render();
assert.equal(state.serviceTierAccess.fast, false, "old identity read cannot restore revoked access");
read = async () => preference;
options = { ...options, accountIdentity: "account-a" }; state = render();
assert.equal(state.serviceTierAccess, null, "returning to an identity starts a new epoch");
await tick(); state = render();
let finishAccountWrite;
write = args => new Promise(resolve => { finishAccountWrite = () => resolve({ ...preference, defaults: args.configuration }); });
const oldAccountWrite = state.selectModel("ui-b");
let finishAccountTurn;
const oldAccountTurn = state.trackTurn("old-account-thread", { model: "wire-a", reasoningEffort: "high", serviceTier: null },
  () => new Promise(resolve => { finishAccountTurn = resolve; }));
await state.onUserMessageCompleted("old-account-thread", "old-account-turn", "old-account-user");
const recentWritesBeforeIdentityChange = calls.filter(call => call.command === "model_recent_record").length;
read = async () => deniedPreference;
options = { ...options, accountIdentity: "account-b" }; state = render(); await tick(); state = render();
finishAccountWrite(); await oldAccountWrite;
finishAccountTurn({ turn: { id: "old-account-turn" } }); await oldAccountTurn;
state = render();
assert.equal(state.getConfiguration().model, "wire-a", "old identity write must not populate new identity scope state");
assert.equal(state.serviceTierAccess.fast, false);
assert.equal(state.selectionError, "");
assert.equal(calls.filter(call => call.command === "model_recent_record").length, recentWritesBeforeIdentityChange,
  "old epoch completed event cannot write recent configurations for the new account");
console.log("PASS MC-B01/04 identity: same-auth account change clears access before read, old read/write ignored, revoked fast preserved, return epoch fresh and old turn history isolated");

const recorded = [];
const ledger = new api.ModelTurnLedger(async config => { recorded.push({ ...config }); });
const a = { model: "wire-a", reasoningEffort: "high", serviceTier: "vendor-fast" };
const b = { model: "wire-b", reasoningEffort: "low", serviceTier: null };
let finishTurn;
const sending = ledger.track("one", a, () => new Promise(resolve => { finishTurn = resolve; }));
await ledger.complete("one", "turn-1", "user-1");
assert.equal(recorded.length, 0);
await assert.rejects(ledger.track("one", b, async () => ({})), /尚未确认/);
finishTurn({ turn: { id: "turn-1" } }); await sending;
assert.equal(recorded[0].model, "wire-a");
await ledger.complete("one", "turn-1", "user-1");
assert.equal(recorded.length, 1);
await ledger.track("two", b, async () => ({ turn: { id: "turn-2" } }));
await ledger.complete("two", "turn-2", "user-2");
assert.equal(recorded[1].model, "wire-b");
await ledger.complete("background", "other", "user-other");
assert.equal(recorded.length, 2);
await assert.rejects(ledger.track("failed", a, async () => { throw Error("transport unknown"); }), /transport unknown/);
await ledger.complete("failed", "unknown-turn", "user-3");
assert.equal(recorded.length, 2);
console.log("PASS MC-B07/09: early item waits for matching turn, exact confirmed configuration, dedup, separate thread, non-UI and failed/unbound requests never counted");
